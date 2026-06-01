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

printf '\nBuilding image: %s\n' "$IMAGE"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --tag="$IMAGE" \
  .

printf '\nDeploying Cloud Run Job: %s\n' "$JOB_NAME"
gcloud run jobs describe "$JOB_NAME" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1 \
  && gcloud run jobs update "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$SERVICE_ACCOUNT" \
    --task-timeout=3600s \
    --max-retries=0 \
    --set-env-vars="USE_SECRET_MANAGER=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCLOUD_PROJECT=${PROJECT_ID},GCP_PROJECT=${PROJECT_ID},VIDEO_STYLE=broll_ken_burns,GCS_PUBLIC_BUCKET=natureswaysoil-social-videos,VIDEO_PUBLIC_BUCKET=natureswaysoil-social-videos,VIDEO_PUBLIC_URL_BASE=https://storage.googleapis.com/natureswaysoil-social-videos,ENABLE_PLATFORMS=youtube\,instagram\,facebook,YT_PRIVACY_STATUS=public,DRY_RUN_LOG_ONLY=false,SEED_PRODUCT_LIMIT=5,VARIATIONS_PER_PRODUCT=5,ROTATION_STATE_FILE=data/rotation-state.json" \
  || gcloud run jobs create "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$SERVICE_ACCOUNT" \
    --task-timeout=3600s \
    --max-retries=0 \
    --set-env-vars="USE_SECRET_MANAGER=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCLOUD_PROJECT=${PROJECT_ID},GCP_PROJECT=${PROJECT_ID},VIDEO_STYLE=broll_ken_burns,GCS_PUBLIC_BUCKET=natureswaysoil-social-videos,VIDEO_PUBLIC_BUCKET=natureswaysoil-social-videos,VIDEO_PUBLIC_URL_BASE=https://storage.googleapis.com/natureswaysoil-social-videos,ENABLE_PLATFORMS=youtube\,instagram\,facebook,YT_PRIVACY_STATUS=public,DRY_RUN_LOG_ONLY=false,SEED_PRODUCT_LIMIT=5,VARIATIONS_PER_PRODUCT=5,ROTATION_STATE_FILE=data/rotation-state.json"

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
gcloud scheduler jobs describe "$SCHEDULER_NAME" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1 \
  && gcloud scheduler jobs update http "$SCHEDULER_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIME_ZONE" \
    --uri="$RUN_URI" \
    --http-method=POST \
    --oauth-service-account-email="$SERVICE_ACCOUNT" \
  || gcloud scheduler jobs create http "$SCHEDULER_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIME_ZONE" \
    --uri="$RUN_URI" \
    --http-method=POST \
    --oauth-service-account-email="$SERVICE_ACCOUNT"

printf '\nRunning one test execution now...\n'
gcloud run jobs execute "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait

printf '\nDone. Cloud Run Job and Cloud Scheduler are configured.\n'
printf 'Job: %s\nRegion: %s\nSchedule: %s (%s)\n' "$JOB_NAME" "$REGION" "$SCHEDULE" "$TIME_ZONE"
