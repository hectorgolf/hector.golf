locals {
  # The full image name deploy-admin.yml pushes to, derived from the repository
  # resource so the two cannot drift apart. Exported as the GH_IMAGE_REPO
  # variable, so the workflow and this file agree by construction.
  admin_image_repo = "${google_artifact_registry_repository.admin.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.admin.repository_id}/admin"
}

resource "google_cloud_run_v2_service" "admin" {
  project  = var.project_id
  name     = "hector-admin"
  location = var.region

  # The service is stateless and rebuildable from the repository in one deploy,
  # so protecting it from deletion buys nothing. The database is the thing that
  # is protected — see firestore.tf.
  deletion_protection = false

  # IAP enforces on whatever hostname reaches the service, including the default
  # run.app URL, so INGRESS_TRAFFIC_ALL does not mean unauthenticated.
  ingress = "INGRESS_TRAFFIC_ALL"

  # Direct IAP on Cloud Run: Google sign-in in front of the service with no load
  # balancer, which is the whole reason this fits the budget. The load-balancer
  # route to the same feature costs roughly $18/month.
  iap_enabled = true

  template {
    service_account = google_service_account.admin_runtime.email

    # Scale to zero. The admin UI is used a handful of times a month, and an
    # idle instance is the one thing here that would cost real money.
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      # Normally `<repo>/admin:latest`, which deploy-admin.yml keeps pointed at
      # the most recent build. var.admin_image overrides it for the first apply
      # on a new project, when no image exists yet to pull.
      image = coalesce(var.admin_image, "${local.admin_image_repo}:latest")

      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = google_firestore_database.hector.name
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
    }
  }

  lifecycle {
    # The deploy workflow owns the image; Terraform owns everything around it.
    # Without this, every `terraform apply` after a deploy would roll the service
    # back to var.admin_image.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.enabled["run.googleapis.com"],
    google_project_service.enabled["iap.googleapis.com"],
  ]
}
