terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.2"
    }
  }

  # The state bucket is created by hand, once, before the first `init`.
  # Terraform cannot describe the bucket that holds its own state, so this is
  # the one piece of infrastructure in this project that is not in this
  # directory. See docs/gcp-setup-playbook.md, step 2.
  #
  # Backend blocks cannot read variables, so the bucket name is literal. If it
  # ever needs to vary, drop the `bucket` line and pass
  # `-backend-config=bucket=...` to `terraform init` instead.
  backend "gcs" {
    bucket = "hector-golf-tfstate"
    prefix = "infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {
  project_id = var.project_id
}
