param([Parameter(Mandatory=$true)][string]$Image, [string]$Gcloud='gcloud')
$ErrorActionPreference='Stop'
if ($Image -notmatch '^asia-east1-docker\.pkg\.dev/pawletter-adoption/pawletter/api:[a-zA-Z0-9._-]+$') {throw 'Use the exact image tag returned by this project Cloud Build.'}
function Invoke-Cloud { & $Gcloud @args; if ($LASTEXITCODE -ne 0) {throw 'Cloud deployment command failed. Stop before subsequent operations.'} }
$project='pawletter-adoption'
$region='asia-east1'
$serviceAccount='pawletter-run@pawletter-adoption.iam.gserviceaccount.com'
$audience='https://pawletter-api-446222711695.asia-east1.run.app'
# A separate migration job must finish before sending traffic to the application revision.
Invoke-Cloud run jobs deploy pawletter-migrate --project=$project --region=$region --image=$Image --service-account=$serviceAccount --set-cloudsql-instances=pawletter-adoption:asia-east1:pawletter-db-test --set-secrets=DATABASE_URL=DATABASE_URL:1 --command=node --args=scripts/migrate.js --max-retries=0 --task-timeout=300s --quiet
Invoke-Cloud run jobs execute pawletter-migrate --project=$project --region=$region --wait --quiet
# Preserve existing Cloud Run public/IAM policy; secrets only appear as Secret Manager references.
Invoke-Cloud run services update pawletter-api --project=$project --region=$region --image=$Image --service-account=$serviceAccount '--update-secrets=DATABASE_URL=DATABASE_URL:1,AI_API_KEY=AI_API_KEY:1,AI_BASE_URL=AI_BASE_URL:1' "--update-env-vars=GCP_PROJECT=$project,GCS_BUCKET=pawletter-media-test,ARCHIVE_GCS_BUCKET=pawletter-archive-media,AI_CHAT_MODEL=gemini-3.8-flash,AI_ASR_MODEL=whisper-1,FRONTEND_ORIGIN=https://pawletter-adoption-h5.chenaaron668.chatgpt.site,WORKER_AUDIENCE=$audience,WORKER_SERVICE_ACCOUNT=$serviceAccount" --concurrency=8 --max-instances=3 --timeout=300s --quiet
# Scheduler creation/update is separate: inspect existing jobs before applying the command in README.
Write-Output 'Application revision deployed. Verify /ready, provision test accounts, then configure worker scheduling.'
