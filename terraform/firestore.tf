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

  # PITR gives 7 days of recoverable history. It is explicitly outside the
  # no-cost quota ($0.00020 per GiB-hour), but the whole dataset is well under a
  # megabyte, so this is fractions of a cent a month for the only undo button
  # this data has once it stops living in Git.
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

  # Monday, so the backup that exists for most of the week is the one taken
  # after the weekend — which is when rounds get played and when the data
  # actually moves. The day is the only timing control there is: Firestore picks
  # the hour itself and documents that it varies, so there is no point trying to
  # place this relative to the scheduler jobs in scheduler.tf.
  weekly_recurrence {
    day = "MONDAY"
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
