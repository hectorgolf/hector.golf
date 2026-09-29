# admin.hector.golf in front of the Cloud Run service.
#
# Off by default, because it cannot be applied until the base domain has been
# verified for this project — `gcloud domains verify hector.golf`, which is a
# Search Console flow and a TXT record at the registrar, and not something
# Terraform can do. Applying before that fails, so the flag keeps a fresh project
# from tripping over a prerequisite it has no way to satisfy.
#
# Why a domain mapping rather than the load balancer Google recommends: the load
# balancer is roughly $18/month, which is eighteen times this project's entire
# budget. Domain mapping is free, europe-north1 is one of the ten regions that
# support it, and the trade is that it is Preview and documented as "not
# recommended for production" on latency grounds. For an admin UI two people open
# a few times a month that is a fair trade, and the run.app URL keeps working
# either way.
#
# IAP is unaffected: it enforces on every hostname the service answers to, so
# admin.hector.golf is protected exactly as the run.app URL is.
locals {
  # An unset GitHub Actions variable arrives as an empty string, not as null, so
  # a null check would read "not configured" as "configured with nothing" and try
  # to map the empty domain. Exactly the trap the OAuth credentials hit.
  admin_domain = var.admin_domain == null ? "" : trimspace(var.admin_domain)
  hooks_domain = var.hooks_domain == null ? "" : trimspace(var.hooks_domain)
}

resource "google_cloud_run_domain_mapping" "admin" {
  count = local.admin_domain == "" ? 0 : 1

  location = var.region
  name     = local.admin_domain

  metadata {
    # The v1 Cloud Run API shape: namespace is the project id, not a namespace.
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.admin.name
    # AUTOMATIC is a Google-managed certificate, provisioned once the DNS record
    # below resolves. Expect 15 minutes, and up to 24 hours.
    certificate_mode = "AUTOMATIC"
  }
}

# hooks.hector.golf in front of the hooks service.
#
# The same mechanism, the same prerequisites and the same Preview caveat as the
# mapping above. Two differences worth knowing:
#
# IAP is *not* in front of this one — that is the entire reason the service
# exists — so unlike admin.hector.golf, this hostname is open to the internet
# and what protects it is the x-api-key the route checks. See
# admin/src/lib/surface.ts.
#
# And it is optional in a way the admin's mapping is not: app.hector.golf is
# configured with a URL, and the run.app URL works perfectly well. A custom
# hostname here buys a name somebody can read in a config file rather than any
# capability, so leaving hooks_domain unset is a real choice rather than an
# unfinished setup.
resource "google_cloud_run_domain_mapping" "hooks" {
  count = local.hooks_domain == "" ? 0 : 1

  location = var.region
  name     = local.hooks_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name       = google_cloud_run_v2_service.hooks.name
    certificate_mode = "AUTOMATIC"
  }
}
