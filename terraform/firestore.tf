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
