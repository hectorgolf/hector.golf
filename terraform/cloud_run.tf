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

    # Explicit, because a job now runs *inside* a request rather than being
    # handed to GitHub.
    #
    # Everything this service did before answered in milliseconds, so the 300s
    # default was never load-bearing and nobody had to know it was there. The
    # handicaps job sweeps 45 players against WiseGolf and then makes two GitHub
    # round trips, which is tens of seconds on a good day and more on a bad one.
    #
    # It cannot be worked around by answering early and finishing in the
    # background: `cpu_idle = true` below throttles the CPU once the response is
    # sent, so the background half would crawl or stall. The request is the job.
    #
    # 600s rather than 300s buys headroom for a slow WiseGolf without being so
    # long that a wedged run holds an instance for the rest of the morning. The
    # lease in `admin/src/lib/jobs/lock.ts` is deliberately longer still, so a run
    # killed by this timeout does not leave a lease that outlives the next tick by
    # much.
    timeout = "600s"

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

      # Which repository the "Run now" buttons and the Cloud Scheduler jobs act
      # on. The same variable that decides which repository may mint tokens
      # through Workload Identity Federation, so this deployment cannot be
      # pointed at one repository for CI and a different one for dispatching.
      env {
        name  = "GITHUB_REPOSITORY"
        value = var.github_repository
      }

      # Where the GitHub token is, rather than the token itself.
      #
      # Cloud Run can inject a secret's value into the environment directly and
      # this deliberately does not use that. A container spec that names a secret
      # version cannot start when the version is missing, which would mean a
      # fresh project — or a rotation done in the wrong order — takes the entire
      # admin down because one button could not work. The same reasoning as the
      # probes below pointing at /livez rather than /readyz. `secrets.ts` reads
      # it per use, which also means `gcloud secrets versions add` is the whole
      # of a rotation, with no redeploy to forget.
      env {
        name  = "GITHUB_DISPATCH_TOKEN_SECRET"
        value = "${google_secret_manager_secret.github_dispatch_token.name}/versions/latest"
      }

      # Where the WiseGolf login is, by the same rule and for the same reason: a
      # container spec that names a secret version cannot start when the version
      # is missing, and a project whose credentials have not been put in yet must
      # still have a working admin.
      env {
        name  = "WISEGOLF_USERNAME_SECRET"
        value = "${google_secret_manager_secret.wisegolf["wisegolf-username"].name}/versions/latest"
      }

      env {
        name  = "WISEGOLF_PASSWORD_SECRET"
        value = "${google_secret_manager_secret.wisegolf["wisegolf-password"].name}/versions/latest"
      }

      # The name of the secret, not the secret — read at call time by
      # `secrets.ts`, for the same reason the three above are names: a container
      # spec that names a secret *version* cannot start when the version is
      # missing, and a project whose credentials have not been put in yet must
      # still have a working admin.
      env {
        name  = "ASTROSITE_API_KEY_SECRET"
        value = "${google_secret_manager_secret.functions["astrosite-api-key"].name}/versions/latest"
      }

      # Where an uploaded file goes, whatever it belongs to — the prefix inside
      # the bucket says that. A name rather than a secret: the bucket is not
      # readable without the bindings in storage.tf, and a service that does not
      # know where to put a file should say so on the page rather than fail at
      # the first upload.
      env {
        name  = "ASSET_BUCKET"
        value = google_storage_bucket.assets.name
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

# ---------------------------------------------------------------------------
# Public access to the four functions.
#
# A gen2 Cloud Function is a Cloud Run service, and `--allow-unauthenticated` is
# not a deploy setting: it is an allUsers -> roles/run.invoker binding on that
# service. gcloud sets it by calling run.services.setIamPolicy on every deploy,
# whether or not the binding is already there.
#
# That is why the first CI deploy went red while succeeding. All four functions
# updated, and then the flag re-asserted a binding that already existed and got
# a 403, because functions-deployer holds no run permissions. Nothing was
# broken; the build simply reported a failure that had not happened.
#
# The fix is not to give the deployer that permission. roles/run.admin would
# also let it redeploy or delete hector-admin, which is not a thing the function
# deploy identity should be able to reach, and a narrower binding scoped per
# service has the same ordering problem as this does with none of the benefit.
#
# So the binding moves here, where IAM already lives, and the deploys stop
# asserting it. Which is the better home for it anyway: allUsers on a public
# endpoint is exactly the kind of grant that should be reviewed in a diff rather
# than implied by a flag in an npm script.
#
# ORDERING. These four services are created by `gcloud functions deploy`, not by
# this configuration, so Terraform can only bind IAM on them once they exist. On
# a fresh project the sequence is: deploy the functions, then apply. Until the
# apply they answer 403 to anonymous callers. See docs/playbooks/gcp-bootstrapping.md.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service_iam_member" "functions_public" {
  for_each = toset([
    "extractscorecardinformation",
    "generateplayeravatar",
    "generateplayerbiography",
    "tournamentleaderboard",
  ])

  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}
