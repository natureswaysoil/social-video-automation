#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-natureswaysoil-video}"
REGION="${REGION:-us-east1}"
JOB_NAME="${JOB_NAME:-social-video-broll-job}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-social-automation-scheduler@${PROJECT_ID}.iam.gserviceaccount.com}"
IMAGE="${IMAGE:-gcr.io/${PROJECT_ID}/${JOB_NAME}:latest}"
SCHEDULE="${SCHEDULE:-0 11,15,17,22 * * *}"
TIME_ZONE="${TIME_ZONE:-America/New_York}"
SCHEDULER_NAME="${SCHEDULER_NAME:-social-video-broll-schedule}"
ENV_FILE="${ENV_FILE:-/tmp/${JOB_NAME}.env.yaml}"
JOB_MEMORY="${JOB_MEMORY:-4Gi}"
JOB_CPU="${JOB_CPU:-2}"
NODE_HEAP_MB="${NODE_HEAP_MB:-2048}"

cat > "$ENV_FILE" <<EOF
USE_SECRET_MANAGER: "true"
GOOGLE_CLOUD_PROJECT: "${PROJECT_ID}"
GCLOUD_PROJECT: "${PROJECT_ID}"
GCP_PROJECT: "${PROJECT_ID}"
NODE_OPTIONS: "--max-old-space-size=${NODE_HEAP_MB}"
VIDEO_STYLE: "broll_ken_burns"
GCS_PUBLIC_BUCKET: "natureswaysoil-social-videos"
VIDEO_PUBLIC_BUCKET: "natureswaysoil-social-videos"
VIDEO_PUBLIC_URL_BASE: "https://storage.googleapis.com/natureswaysoil-social-videos"
ENABLE_PLATFORMS: "youtube,instagram,facebook"
YT_PRIVACY_STATUS: "public"
DRY_RUN_LOG_ONLY: "false"
SEED_PRODUCT_LIMIT: "5"
VARIATIONS_PER_PRODUCT: "5"
ROTATION_STATE_FILE: "data/rotation-state.json"
EOF

printf '\nGranting service account access needed by the job.\n'
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet >/dev/null

gcloud storage buckets add-iam-policy-binding gs://natureswaysoil-social-videos \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin" \
  --condition=None \
  --quiet >/dev/null || true

printf '\nBuilding image: %s\n' "$IMAGE"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --tag="$IMAGE" \
  .

printf '\nDeploying Cloud Run Job: %s\n' "$JOB_NAME"
printf 'Memory: %s | CPU: %s | Node heap: %s MB\n' "$JOB_MEMORY" "$JOB_CPU" "$NODE_HEAP_MB"
if gcloud run jobs describe "$JOB_NAME" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$SERVICE_ACCOUNT" \
    --memory="$JOB_MEMORY" \
    --cpu="$JOB_CPU" \
    --task-timeout=3600s \
    --max-retries=0 \
    --command=node \
    --args="--max-old-space-size=${NODE_HEAP_MB},dist/post-scheduled.js" \
    --env-vars-file="$ENV_FILE"
else
  gcloud run jobs create "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$SERVICE_ACCOUNT" \
    --memory="$JOB_MEMORY" \
    --cpu="$JOB_CPU" \
    --task-timeout=3600s \
    --max-retries=0 \
    --command=node \
    --args="--max-old-space-size=${NODE_HEAP_MB},dist/post-scheduled.js" \
    --env-vars-file="$ENV_FILE"
fi

printf '\nGranting Cloud Scheduler permission to run the job.\n'
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SCHEDULER_SA="service-${PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker" >/dev/null || true

RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

printf '\nCreating/updating Cloud Scheduler job: %s\n' "$SCHEDULER_NAME"
if gcloud scheduler jobs describe "$SCHEDULER_NAME" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIME_ZONE" \
    --uri="$RUN_URI" \
    --http-method=POST \
    --oauth-service-account-email="$SERVICE_ACCOUNT"
else
  gcloud scheduler jobs create http "$SCHEDULER_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIME_ZONE" \
    --uri="$RUN_URI" \
    --http-method=POST \
    --oauth-service-account-email="$SERVICE_ACCOUNT"
fi

printf '\nRunning one test execution now...\n'
gcloud run jobs execute "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait

printf '\nDone. Cloud Run Job and Cloud Scheduler are configured.\n'
printf 'Job: %s\nRegion: %s\nSchedule: %s (%s)\nMemory: %s\nCPU: %s\nNode heap: %s MB\n' "$JOB_NAME" "$REGION" "$SCHEDULE" "$TIME_ZONE" "$JOB_MEMORY" "$JOB_CPU" "$NODE_HEAP_MB"
