# Deployment

The intended production target is Azure Container Apps with:
- API service in ACA
- runner as ACA Job or dedicated workload profile job
- Azure Database for PostgreSQL
- Azure Cache for Redis
- Azure Blob Storage
- Azure AD as the upstream OIDC provider

Terraform scaffolding lives in `infra/terraform`.

See [/Volumes/ML/raku-relay/howto.md](/Volumes/ML/raku-relay/howto.md) for the step-by-step deployment explanation and architecture diagrams.
