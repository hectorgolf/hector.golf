# The budget alert, off by default.
#
# Creating a budget needs permissions on the *billing account*, not the project,
# and terraform-ci deliberately has none — a CI identity that can rewrite
# billing is a worse risk than a budget created by hand. So either set
# enable_budget_alert = true and run `terraform apply` locally as yourself once,
# or click it together in the console. Either way, do it on day one.
#
# Why it matters here: this project has billing enabled, which means Firestore
# has no hard spending cap the way a Spark-plan project does. The free quota is
# generous enough that normal use will never approach it, but a runaway write
# loop in a half-finished admin endpoint bills rather than stops.
resource "google_billing_budget" "hector" {
  count = var.enable_budget_alert ? 1 : 0

  billing_account = var.billing_account
  display_name    = "hector.golf — alert above €${var.budget_amount_eur}/month"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "EUR"
      units         = tostring(var.budget_amount_eur)
    }
  }

  # 50% is the "something changed" signal, 100% is "look now", 200% is "it is
  # still climbing". All three go to the billing account's default recipients.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 2.0
  }

  depends_on = [google_project_service.enabled["billingbudgets.googleapis.com"]]
}
