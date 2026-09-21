# ---------------------------------------------------------------------------
# Where a file uploaded in the admin waits until it is published.
#
# The admin accepts a file from whoever is editing, puts it here, and the
# Firestore document records the object's name. `npm run export` downloads what
# a record references and writes it into the site's `public/`, which is what is
# actually served. See docs/plans/courses-in-the-admin.md, step 5.
#
# ## One bucket, prefixed by what the file belongs to
#
# `assets` rather than `course-images`, because course descriptions are the
# first thing to need this and obviously not the last: player portraits and an
# optional hero image per event are both a short step away, and three buckets
# would mean three sets of bindings, three environment variables and three
# places to get the access wrong.
#
# The prefix is the collection the file belongs to, and the admin composes it:
#
#     courses/{course_id}/{key}.{ext}
#     players/{player_id}/{key}.{ext}     # when there is a portrait to upload
#     events/{event_id}/{key}.{ext}       # when an event page wants a hero
#
# Nothing enforces that shape — object names are flat strings and the bucket
# does not care — so the enforcement is that one function composes them. A
# prefix somebody invents at a call site is how two collections end up sharing
# a directory.
#
# ## Why a bucket rather than committing the image straight away
#
# The admin can already commit to the repository — it does, for handicap backups
# and the club list — so uploading could skip this entirely and push the file to
# git on the spot. That would publish it on the spot too.
#
# Everything else the admin authors reaches the public site only when somebody
# presses Publish, and an image is the last thing that should be the exception:
# a photograph uploaded into the wrong course, or one somebody thinks better of
# thirty seconds later, would already be in the repository's history and on the
# site. Here it waits, costs nothing while it waits, and reaches git through the
# same export as the record that references it.
#
# The cost, stated rather than discovered: an image uploaded and then abandoned
# stays in the bucket. Nothing collects those, because the only safe collector
# would need to know every document that could reference one, and getting that
# wrong deletes a published picture. At a few megabytes a year this is cheaper
# than the mechanism would be.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "assets" {
  project  = var.project_id
  name     = "${var.project_id}-assets"
  location = var.region

  # No object is ever served from here. The site reads committed files; this is
  # a staging area between the editor and the export, so nothing outside the two
  # identities below has any business reading it. That is also what keeps the
  # bucket cheap to share: there is no per-collection privacy to get right,
  # because nothing here is public at all.
  public_access_prevention    = "enforced"
  uniform_bucket_level_access = true

  # Deleting an image from a description does not delete the object, and should
  # not: the committed copy is what the site serves, and git is where an undo
  # comes from. Versioning here would be a second history of the same files.
  versioning {
    enabled = false
  }

  # Both, and the second one is not obvious until it bites.
  #
  # Terraform creates the role binding in iam.tf and this bucket in parallel
  # unless told otherwise, and on the first apply — 2026-09-21 — the bucket lost
  # that race by one second:
  #
  #     google_project_iam_member.terraform_ci["roles/storage.admin"]: Creating...
  #     google_storage_bucket.assets: Creating...
  #     terraform_ci[...]: Creation complete after 7s
  #     Error 403: terraform-ci@... does not have storage.buckets.create access
  #
  # The identity applying this is granted the role *by* this configuration, so
  # the grant has to exist before the thing it permits. `depends_on` on the whole
  # `terraform_ci` binding rather than one key of it: the map is created as a
  # unit, and naming a key here would be a second place to edit the day the role
  # list changes.
  #
  # Ordering is necessary and may not be sufficient on a fresh project — an IAM
  # grant is not visible to the next request immediately, which
  # docs/playbooks/gcp-bootstrapping.md says about several other grants. If a
  # first apply still fails with 403 here, the second one succeeds, and that is
  # the propagation rather than this line being wrong.
  depends_on = [
    google_project_service.enabled["storage.googleapis.com"],
    google_project_iam_member.terraform_ci,
  ]
}

# ---------------------------------------------------------------------------
# Bucket-scoped, both of them, and that is the whole point.
#
# `iam.tf` already carries the reason at length: hector-golf-tfstate lives in
# this same project, so a *project-wide* storage role on either of these
# identities would hand an application account the infrastructure state. The
# warning there is about roles/storage.objectAdmin on a deployer; it applies
# exactly as much here, and the answer is the same — bind on the bucket.
# ---------------------------------------------------------------------------

# The admin writes files and deletes the ones it replaces. objectUser rather
# than objectAdmin: the difference is `storage.buckets.*`, which the service has
# no reason to hold — it should not be able to reconfigure or delete the bucket
# it writes into.
resource "google_storage_bucket_iam_member" "admin_runtime_writes_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectUser"
  member = google_service_account.admin_runtime.member
}

# The export reads them, and reads is all it does — it downloads what a record
# references and commits it. It runs as admin_deployer, which is the identity
# behind GH_DEPLOYER_SA in export-admin-data.yml.
resource "google_storage_bucket_iam_member" "deployer_reads_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.admin_deployer.member
}
