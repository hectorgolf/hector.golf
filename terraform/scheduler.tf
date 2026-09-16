# Starting the data-update workflows on time.
#
# ## Why this exists
#
# The workflows carry their own `schedule:` crons and have done for years. The
# problem is that GitHub queues `schedule` events and delivers them when it has
# capacity: measured across the last 300 scheduled runs of update-handicaps.yml,
# the 03:00 slot was a median of 2h22m late in April and 4h32m late in September,
# and not one run in that sample started on time. `workflow_dispatch` has no such
# queue, so a clock that calls the dispatch API gets a run that starts now.
#
# Cloud Scheduler is that clock. It does not call GitHub directly — the admin
# service does, because that is where the token already has to live for the
# "Run now" button in the UI to work, and one path is one thing to get wrong.
#
# The crons stay in the workflow files as a backstop. If this project is down,
# the updates still happen, just as late as they always did.
#
# ## Two jobs, not one per workflow
#
# Cloud Scheduler bills per job per month, not per execution, and the first three
# on a billing account are free — so a job per workflow per time slot would put
# this project over a threshold it otherwise sits under, against the budget in
# budget.tf. Two jobs that each say "run the scheduled updates" stay inside it.
#
# The split that leaves is the useful one. *When* stays here, where
# `gcloud scheduler jobs list` can answer it without reading TypeScript — which
# matters more than usual, given this mechanism exists because nobody could tell
# when a job really ran. *What* lives in DISPATCHABLE_WORKFLOWS, so adding a
# workflow to the twice-daily run needs no infrastructure change at all.

# The identity the schedule calls as. Distinct from the admin's runtime identity:
# this one needs to get *in* to the service and nothing else, while that one
# needs Firestore and the token and cannot reach the front door at all.
resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "hector-scheduler"
  display_name = "hector.golf scheduled data updates"
  description  = "Calls the admin service's dispatch endpoint on a schedule. Holds no data access of its own."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]
}

# Cloud Scheduler does not sign OIDC tokens itself; it asks IAM to mint one as
# the account above, which its own service agent must be allowed to do.
#
# The service agent does not exist in a new project until something asks for it,
# and a binding naming a service account that does not exist fails — the same
# chicken-and-egg the IAP service agent has, and with the same answer: a
# `gcloud beta services identity create` in the playbook, before the first apply.
resource "google_service_account_iam_member" "scheduler_agent_mints_tokens" {
  service_account_id = google_service_account.scheduler.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"

  depends_on = [google_project_service.enabled["cloudscheduler.googleapis.com"]]
}

# The schedule is a caller like any other, so it gets in the way everybody gets
# in: through IAP, holding the same role the humans in var.admin_principals hold.
# There is deliberately no back door — no second ingress, no run.invoker binding
# that would let something skip the front door — because a bypass is a thing that
# would then need its own authentication, written here, by us.
resource "google_iap_web_cloud_run_service_iam_member" "scheduler" {
  project                = var.project_id
  location               = google_cloud_run_v2_service.admin.location
  cloud_run_service_name = google_cloud_run_v2_service.admin.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = google_service_account.scheduler.member
}

# GitHub Actions impersonates this same identity to ask for a deploy once a
# scrape has committed something. Bound to main, like admin_deployer_wif.
#
# The same account rather than a second one, because a second one would be this
# one with a different name: identical purpose — "start a data-update workflow"
# — and the identical IAP grant above, which is the only permission either needs.
# Two names for one authority is a thing to keep in step rather than a boundary.
#
# What this does not do is give Actions a way past IAP. It gets in the same front
# door as Cloud Scheduler and the humans, holding a token minted for the IAP
# audience; the endpoint it reaches still reads the identity from the IAP header.
resource "google_service_account_iam_member" "scheduler_wif" {
  service_account_id = google_service_account.scheduler.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.ref/refs/heads/main"
}

locals {
  # When the data updates run, in UTC. Each job starts everything marked
  # `scheduled` in admin/src/lib/workflows.ts.
  #
  # ## Still two jobs, and that is the constraint
  #
  # Cloud Scheduler's free tier is three *jobs* per billing account, billed per
  # job per month rather than per execution. So a job that fires ten times a day
  # costs exactly what a job that fires once does, and the way to scrape more
  # often is a busier cron rather than more jobs. There is one job spare; it is
  # not spent here.
  #
  # ## Why the morning is a window rather than a moment
  #
  # We play in Europe and a realistic early tee time is 04:00 to 07:00 UTC. A
  # handicap that arrives after the first tee shot is too late to be the handicap
  # anyone played off, so the morning scrape wants to cover that whole window
  # rather than guess one time inside it.
  #
  # It has to, because the thing it is waiting for does not keep to a time. The
  # Finnish Golf Union computes overnight at about 03:00 Finnish and re-runs a
  # failed batch during office hours — docs/current/handicap-updates.md has the
  # detail. On 2026-09-14 the numbers landed between 06:00 and 08:22 Finnish; the
  # single 03:00 UTC scrape ran at 06:00:36 local, missed them by seconds, read
  # every player as unchanged, and the site carried yesterday's handicaps until
  # the afternoon. Hourly from 03:00 to 07:00 would have caught it within the
  # hour.
  #
  # The last tick before a Hector's buckets freeze matters most: the freeze is
  # 08:00 local to the event, which is 05:00 UTC for a Finnish venue and 06:00
  # UTC for Konopiště, so the last useful tick is 04:00 and 05:00 respectively.
  # That leaves an hour in which a handicap can arrive and miss the buckets,
  # which is the cost of hourly over half-hourly and is accepted deliberately:
  # the buckets are projected until the morning of the event, and a value that
  # late is one the Union itself published late.
  #
  # ## The afternoon
  #
  # One tick, for a retry that finished during office hours. Not a window: by
  # then the round is under way and the handicaps are whatever they were at the
  # first tee, so this is about the site being right rather than about anyone
  # playing off it.
  #
  # ## What a tick costs
  #
  # A wake-up of the admin service, which scales to zero, and two GitHub workflow
  # runs of a couple of minutes each. Both are inside free tiers. The workflows
  # share one `data-update` concurrency group, so a tick that arrives while the
  # previous one is still running queues rather than races — which is the
  # interlock that makes a higher cadence safe at all.
  data_update_schedules = {
    # Hourly across the early-tee-time window.
    morning = { cron = "0 3-7 * * *" }
    midday  = { cron = "0 12 * * *" }
  }
}

resource "google_cloud_scheduler_job" "data_update" {
  # IAP's OAuth client id is the audience these tokens have to carry, so without
  # it there is nothing to authenticate to and the jobs would fire into a 401
  # twice a day. Left out of the plan entirely until step 5 of the playbook has
  # been done, the same way google_iap_settings is.
  for_each = local.iap_configured ? local.data_update_schedules : {}

  project = var.project_id
  # NOT var.region. Cloud Scheduler does not run in europe-north1, where the rest
  # of this project lives — see var.scheduler_region for the whole story. This is
  # the one resource here that is deliberately somewhere else.
  region      = var.scheduler_region
  name        = "hector-data-update-${each.key}"
  description = "Starts the scheduled data updates via the admin service, because GitHub's own cron runs hours late."

  schedule = each.value.cron
  # UTC rather than Europe/Helsinki: these times are written as UTC in the
  # workflow files, the architecture docs and this file, and a scheduler that
  # silently shifted by an hour twice a year would make all three wrong for half
  # the year each.
  time_zone = "Etc/UTC"

  # Generous for a call that asks GitHub to do something and returns: the service
  # scales to zero, so the slow case is a cold start plus a secret read plus one
  # API call, not the workflow itself — which runs on GitHub long after this
  # request has been answered.
  attempt_deadline = "120s"

  retry_config {
    # GitHub being briefly unreachable should not cost a day's update.
    #
    # The endpoint fans out, so a retry after a partial failure re-dispatches the
    # workflows that already succeeded. That is the better half of the trade: a
    # repeated handicap reading is kept as another reading rather than corrupting
    # the first, the runs are serialised by the shared concurrency group, and a
    # silently skipped workflow is the exact failure this mechanism exists to
    # stop.
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  http_target {
    http_method = "POST"
    # The fan-out endpoint: it starts every workflow marked `scheduled`, so what
    # runs is decided in one list in the application rather than by which jobs
    # happen to exist here.
    uri = "${google_cloud_run_v2_service.admin.uri}/api/workflows/dispatch"

    # JSON rather than a form content type, and it matters: Astro's CSRF check
    # rejects a cross-origin POST that carries a form content type *or no content
    # type at all*, and neither this nor curl sends a browser's Origin header.
    # Sending JSON is what lets one endpoint serve both this and the button in the
    # UI. The body is empty because the URL already says everything — which
    # workflow to start. `.github/actions/request-deploy` has to spell the same
    # request the same way; it did not, and returned 403 until it did.
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      # IAP validates the token against the OAuth client configured for the
      # service, so the audience is that client id — not the URL being called,
      # which is what the audience would be for a Cloud Run service without IAP
      # in front of it. Getting this wrong produces a 401 at 03:00 and no other
      # symptom.
      audience = local.iap_client_id
    }
  }

  depends_on = [
    google_project_service.enabled["cloudscheduler.googleapis.com"],
    google_service_account_iam_member.scheduler_agent_mints_tokens,
    google_iap_web_cloud_run_service_iam_member.scheduler,
    # Same reason as in secrets.tf: cloudscheduler.admin is granted to
    # terraform-ci by iam.tf, and without this edge the grant and the first use
    # of it are unordered within the same apply.
    google_project_iam_member.terraform_ci,
  ]
}

# ---------------------------------------------------------------------------
# The third job: the handicaps job running inside the admin service.
#
# This is the tick for docs/plans/handicaps-to-firestore.md. It is a job of its
# own rather than another entry in the fan-out above, for two reasons that both
# come down to it doing the work rather than delegating it.
#
# ## It is the last free job
#
# Cloud Scheduler's free tier is three jobs per billing account. The comment on
# `data_update_schedules` above says there is one spare and that it is not spent
# there; this is what it is spent on. There is no fourth, so when the other three
# scrapes follow, they join *this* job's fan-out rather than getting their own —
# which is why `admin/src/lib/jobs/registry.ts` is a list from the first day it
# holds one entry.
#
# ## Its deadline is a real number rather than a generous one
#
# The fan-out above returns as soon as GitHub accepts a dispatch, so 120s is
# slack it never uses. This one holds the request open for the whole sweep, and a
# deadline shorter than the work does not cancel the run — Cloud Scheduler stops
# waiting, the Cloud Run request carries on, and the retry starts a second sweep
# on top of the first. The lease in the application is what actually prevents
# that; this number is what stops it being routine.
#
# 540s sits under the service's own 600s timeout, so the service is the thing
# that gives up first and the failure has a log line attached to it rather than
# being a client-side deadline with nothing on the other end.
#
# ## Why it runs an hour after the morning window
#
# While step 1 of the plan is running this job is in shadow mode, and its whole
# purpose is to be compared against what `update-handicaps.yml` wrote. Running it
# after the window rather than inside it means it reads a `handicaps.json` that
# the old pipeline has finished with, so a disagreement is a real disagreement
# rather than a race.
#
# That ordering is also the transition's blind spot, and the plan says so: the
# reconcile means this job usually imports the old pipeline's rows before
# deciding, so its own change detection is rarely exercised. The shadow diffs in
# the run log are what make that visible.
# ---------------------------------------------------------------------------
resource "google_cloud_scheduler_job" "handicaps_job" {
  count = local.iap_configured ? 1 : 0

  project = var.project_id
  # NOT var.region, for the same reason as the jobs above.
  region      = var.scheduler_region
  name        = "hector-handicaps-job"
  description = "Runs the admin service's own handicaps job. See docs/plans/handicaps-to-firestore.md."

  # 08:00 UTC: an hour after the last morning tick of the fan-out above, and
  # before the 08:00 deploy backstop has anything to publish.
  schedule  = "0 8 * * *"
  time_zone = "Etc/UTC"

  attempt_deadline = "540s"

  retry_config {
    # One retry, not three. A retry here is another full sweep of WiseGolf rather
    # than another API call, and the run it would be retrying may still be going.
    # The cost of not retrying is a missed shadow run; the cost of retrying hard
    # is hammering somebody else's API on the morning it is already struggling.
    retry_count          = 1
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.admin.uri}/api/jobs/handicaps/run"

    # Same spelling as the jobs above, and for the same Astro CSRF reason: a POST
    # with no content type at all is rejected, not only a form-typed one.
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.iap_client_id
    }
  }

  depends_on = [
    google_project_service.enabled["cloudscheduler.googleapis.com"],
    google_service_account_iam_member.scheduler_agent_mints_tokens,
    google_iap_web_cloud_run_service_iam_member.scheduler,
    google_project_iam_member.terraform_ci,
  ]
}
