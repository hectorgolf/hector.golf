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
# ## Cost
#
# Cloud Scheduler bills per job per month, not per execution, and the first three
# jobs on a billing account are free. Four jobs is therefore about $0.10/month
# against the budget in budget.tf. Collapsing the two workflows into one job per
# time slot would make it free again; it is not done because a job per workflow
# is what makes the Cloud Scheduler console readable, and the four lines below
# are where to change that decision.

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

locals {
  # Slug (matching DISPATCHABLE_WORKFLOWS in admin/src/lib/workflows.ts) and when
  # to run it, in UTC.
  #
  # 03:00 and 12:00 are the times the workflows' own crons were always meant to
  # fire at, give or take: 05:00/06:00 and 14:00/15:00 in Finland, depending on
  # the season. Leaderboards keep their quarter-past offset so the two scrapes do
  # not commit on top of each other and lose a race in `git pull -r`.
  #
  # Note that 12:00 is an hour earlier than update-handicaps.yml's own `0 3,13`.
  # That is the point of moving it: deploy.yml's cron is `30 3,12`, so a handicap
  # update that lands at 13:00 has always missed the rebuild that was waiting for
  # it and sat until the next one.
  data_update_schedules = {
    handicaps-morning = { workflow = "handicaps", cron = "0 3 * * *" }
    handicaps-midday  = { workflow = "handicaps", cron = "0 12 * * *" }

    leaderboards-morning = { workflow = "leaderboards", cron = "15 3 * * *" }
    leaderboards-midday  = { workflow = "leaderboards", cron = "15 12 * * *" }
  }
}

resource "google_cloud_scheduler_job" "data_update" {
  # IAP's OAuth client id is the audience these tokens have to carry, so without
  # it there is nothing to authenticate to and the jobs would fire into a 401
  # twice a day. Left out of the plan entirely until step 5 of the playbook has
  # been done, the same way google_iap_settings is.
  for_each = local.iap_configured ? local.data_update_schedules : {}

  project     = var.project_id
  region      = var.region
  name        = "hector-${each.key}"
  description = "Starts ${each.value.workflow} via the admin service, because GitHub's own cron runs hours late."

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
    # GitHub being briefly unreachable should not cost a day's update. A retry
    # can dispatch a second run if the first was accepted and the answer was
    # lost, which is harmless here: a second handicap run replaces the day's
    # entry rather than appending a duplicate, and the workflows' concurrency
    # groups keep the two from overlapping.
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.admin.uri}/api/workflows/${each.value.workflow}/dispatch"

    # JSON rather than a form content type, and it matters: Astro's CSRF check
    # fires on form content types and would reject a POST that arrives without a
    # browser's Origin header. Sending JSON is what lets one endpoint serve both
    # this and the button in the UI. The body is empty because the URL already
    # says everything — which workflow to start.
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
  ]
}
