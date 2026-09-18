# The database. Three of these settings cannot be changed after creation —
# `location_id`, `type` and `database_edition` — so a mistake here is a
# destroy-and-recreate, taking the data with it. That is the main reason this
# database is created by Terraform rather than by hand: the config is proven by
# having actually run.
resource "google_firestore_database" "hector" {
  project     = var.project_id
  name        = var.firestore_database_id
  location_id = var.region

  # FIRESTORE_NATIVE is required when database_edition is ENTERPRISE.
  type             = "FIRESTORE_NATIVE"
  database_edition = "ENTERPRISE"

  # Enterprise edition exposes three data-access modes independently. We reach
  # the database with the Firestore server SDK from Cloud Run, so:
  #   - the Firestore API is on,
  #   - MongoDB compatibility is off (nothing here speaks the Mongo wire protocol),
  #   - real-time updates are off, because there are no listeners and it is a
  #     separately billed SKU.
  firestore_data_access_mode          = "DATA_ACCESS_MODE_ENABLED"
  mongodb_compatible_data_access_mode = "DATA_ACCESS_MODE_DISABLED"
  realtime_updates_mode               = "REALTIME_UPDATES_MODE_DISABLED"

  # PITR gives 7 days of recoverable history. It is explicitly outside the free
  # tier, and billed on the database size at a rate in the same order as storing
  # the data itself. The whole dataset is well under a megabyte, so this is
  # fractions of a cent a month for the only undo button this data has once it
  # stops living in Git.
  #
  # Rates move, so read them rather than trusting a comment:
  # https://cloud.google.com/firestore/enterprise/pricing — the *Enterprise*
  # sheet, because that is the edition below. The Standard one is what search
  # engines return and it prices some of the same lines differently.
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"

  # The two most important lines in this repository.
  #
  # DELETE_PROTECTION_ENABLED stops the API deleting the database at all.
  # deletion_policy = "ABANDON" stops Terraform trying: a `terraform destroy`
  # removes it from state and leaves the database alone. The provider's own
  # examples all show "DELETE"; copying that means one stray destroy takes the
  # tournament history with it, and unlike the JSON files there is no
  # `git revert` for a dropped Firestore database.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.enabled["firestore.googleapis.com"]]
}

# Weekly backups, kept for four weeks.
#
# This is the second half of the undo button, and it covers a different failure
# than PITR above. PITR is for the mistake you notice: seven days of history at
# one-minute granularity, so a bad write on Tuesday is recoverable on Friday.
# Backups are for the mistake nobody noticed — a tournament quietly mangled in
# March and spotted in April — which is the failure this data actually has,
# because almost nothing reads the old rows until someone goes looking.
#
# Weekly only, and no daily schedule beside it. A database may have one of each,
# but a daily schedule would cover days 1-7, which is exactly the window PITR
# already covers and covers better. Weekly picks up where PITR stops.
resource "google_firestore_backup_schedule" "weekly" {
  project  = var.project_id
  database = google_firestore_database.hector.name

  # Seconds, because the API takes a duration. var.firestore_backup_retention_weeks
  # is where the number and its ceiling are argued.
  retention = "${var.firestore_backup_retention_weeks * 7 * 24 * 60 * 60}s"

  # Wednesday. The backup worth having is the one holding a *settled* weekend,
  # and the weekend does not settle at the weekend.
  #
  # Monday is the obvious choice and the wrong one. Sunday's rounds only become
  # rows here once the Golf Union has computed them and a sweep has read them:
  # the batch runs overnight at about 03:00 Finnish, and the ticks in
  # scheduler.tf collect at 03:00, 05:00, 07:00 and 12:00 UTC. Worse, Firestore
  # picks the hour of a backup itself and documents that it varies, and the API
  # defines this day in UTC — so "MONDAY" includes the three hours before
  # Monday's first tick has run. That backup would be a whole weekend behind,
  # and only in some weeks, which is the worst way for it to be wrong.
  #
  # Tuesday closes that gap but not the real one. A weekend of tournaments is
  # exactly when the Golf Union has larger corrections to make by hand, and
  # nothing guarantees they land on Monday — scheduler.tf's note on the morning
  # window is about the same unpredictability, one day earlier in the chain. A
  # failed batch is re-run during office hours; a correction that needs a person
  # can slip a day past that.
  #
  # Wednesday buys that second working day. The price is that each backup is up
  # to two days staler than it could be, which matters not at all: PITR covers
  # the preceding seven days underneath this, so the recent past is not what
  # these copies are for.
  weekly_recurrence {
    day = "WEDNESDAY"
  }

  # Matches the database above, and for the same reason rather than out of
  # symmetry. `terraform destroy` leaves the database alive by design; if it
  # deleted this, it would leave a live database with nothing backing it up and
  # no error anywhere to say so. The two have to be abandoned together.
  #
  # The cost is the same as the database's: after an abandon, a fresh apply
  # fails with ALREADY_EXISTS rather than adopting what is there. Recover it
  # with an `import` block — the id format is
  # projects/{project}/databases/{database}/backupSchedules/{name}, and the name
  # is a server-assigned uuid you read from
  # `gcloud firestore backups schedules list --database=hector`. The import
  # section near the end of docs/playbooks/gcp-bootstrapping.md has the
  # procedure.
  deletion_policy = "ABANDON"
}

# The two composite indexes the run log needs.
#
# Firestore indexes every field on its own automatically, which covers most of
# what this project asks of it — but not a query that filters on one field and
# orders by another, and both halves of the run log do exactly that: "this
# workflow's runs, newest first", "this job's runs, newest first". Without these
# the query fails with FAILED_PRECONDITION and a link to a console page that
# creates the index by hand.
#
# Declared here rather than created from that link because of how the failure
# reads from the outside. Both call sites catch and degrade to an empty list, so
# a missing index does not raise an error anywhere a person looks: the Operations
# page simply says "No runs recorded yet" about a service that has been running
# happily for weeks. That is a bad enough failure mode to be worth the terraform,
# and a one-line reason to never let one of these queries exist undeclared.
#
# The order of the fields matters and is not alphabetical: the equality field
# comes first, then the one being ordered on, in the direction it is ordered.
# Firestore serves the reverse direction from the same index, so DESCENDING here
# also answers an ascending scan.
resource "google_firestore_index" "job_runs_by_slug" {
  project    = var.project_id
  database   = google_firestore_database.hector.name
  collection = "job-runs"

  fields {
    field_path = "slug"
    order      = "ASCENDING"
  }

  fields {
    field_path = "startedAt"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "workflow_runs_by_slug" {
  project    = var.project_id
  database   = google_firestore_database.hector.name
  collection = "workflow-runs"

  fields {
    field_path = "slug"
    order      = "ASCENDING"
  }

  fields {
    field_path = "startedAt"
    order      = "DESCENDING"
  }
}
