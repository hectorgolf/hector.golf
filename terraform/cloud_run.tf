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

      # Both probes hit /livez, which touches nothing. Pointing them at /readyz
      # instead would mean an unreachable Firestore stops the service from
      # starting and then restarts it in a loop — turning a dependency being
      # down into this service being down too. /readyz stays a thing a human
      # asks, not a thing that can kill the container.
      #
      # Not /healthz: Google's frontend reserves the internal z-page names and
      # answers them with its own 404 before the container sees them.
      startup_probe {
        # failure_threshold * period_seconds is the startup budget and cannot
        # exceed 240s. 30s is generous for a Node server that binds in under a
        # second, and the cost of being wrong here is a container shut down
        # mid-start.
        period_seconds    = 3
        timeout_seconds   = 2
        failure_threshold = 10

        http_get {
          path = "/livez"
        }
      }

      liveness_probe {
        # ~90s of consecutive failure before a restart. Deliberately slack: the
        # only thing a restart fixes is a wedged process, and a restart loop on
        # a service this small is worse than a slow recovery.
        period_seconds    = 30
        timeout_seconds   = 3
        failure_threshold = 3

        http_get {
          path = "/livez"
        }
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
