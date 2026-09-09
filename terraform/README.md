# terraform/

Infrastructure for the hector.golf admin service and its Firestore database, in the `hector-golf`
GCP project (`europe-north1`).

**Read [`docs/gcp-setup-playbook.md`](../docs/gcp-setup-playbook.md) before running anything here.**
Three of the settings in `firestore.tf` cannot be changed after the first apply, and the state
bucket has to exist before `terraform init` will work.

| File | Contents |
| --- | --- |
| `versions.tf` | Provider and version pins, the GCS state backend, the project data source |
| `variables.tf` | Every input, with why it exists |
| `apis.tf` | The Google APIs this project needs |
| `firestore.tf` | The database — Enterprise edition, delete-protected |
| `artifact_registry.tf` | Admin container images and their cleanup policies |
| `cloud_run.tf` | The `hector-admin` service |
| `iap.tf` | Identity-Aware Proxy: the service agent binding and who may sign in |
| `iam.tf` | Three service accounts and their roles |
| `github_oidc.tf` | Workload Identity Federation for GitHub Actions |
| `budget.tf` | The €1/month billing alert, off by default |
| `outputs.tf` | The values that become GitHub Actions variables |

Applied by [`terraform-apply.yml`](../.github/workflows/terraform-apply.yml) on merge to `main`,
behind the `infrastructure` environment's required review. Planned on every pull request by
[`terraform-plan.yml`](../.github/workflows/terraform-plan.yml).

Not managed here: the Terraform state bucket (it cannot describe itself), the four hand-deployed
Cloud Functions under `backend/`, and the public site, which is still a static GitHub Pages build.
