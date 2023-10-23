#!/bin/bash
set -euo pipefail

source .buildkite/scripts/common/util.sh
source .buildkite/scripts/steps/functional/common_cypress.sh
.buildkite/scripts/bootstrap.sh

export JOB=kibana-security-solution-chrome

buildkite-agent meta-data set "${BUILDKITE_JOB_ID}_is_test_execution_step" "true"

echo "--- Serverless Security Second Quality Gate"
cd x-pack/test/security_solution_cypress
set +e

RP_API_KEY_ENC="U2FsdGVkX1/R7tc2Ty8Yetg83PXdFD/WciAwZo1InWUMrIq59Hmgo7+jyY+HMrPF bhZ5fzkxGh1TDsSnFRSPWgvkeVMAcuAWaC11cR2byO4M4/gc43U5iN7RECuehDxW"
# REPORTING_API_KEY=$(retry 5 5 vault read -field=api_key secret/kibana-issues/dev/security-solution-reporting-key)
QA_API_KEY=$(retry 5 5 vault read -field=qa_api_key secret/kibana-issues/dev/security-solution-qg-enc-key)
VAULT_DEC_KEY=$(retry 5 5 vault read -field=enc_key secret/kibana-issues/dev/security-solution-qg-enc-key)
RP_API_KEY=$(echo $RP_API_KEY_ENC | openssl aes-256-cbc -d -a -pass pass:$VAULT_DEC_KEY)

EXECUTION_MODE_CI=${CI:-}
if [ $EXECUTION_MODE_CI == "true" ];
then
    EXECUTION_MODE="CI"
else
    EXECUTION_MODE="Local"
fi

DATE_BEFORE=$(date -u "+%Y-%m-%dT%H:%M:%S+00:00")
REQUEST_BODY='{
        "name": "security_solution_QA_cypress",
        "description": "The security solution cypress tests for QA quality gate\n'$BUILDKITE_BUILD_URL'",
        "startTime": "'$DATE_BEFORE'",
        "mode": "DEFAULT",
        "attributes": [
            {
                "value": "QA"
            },
            {   
                "key": "Creator",
                "value": "'$BUILDKITE_BUILD_CREATOR'"
            },
            {   
                "key": "Branch",
                "value": "'$BUILDKITE_BRANCH'"
            },
            {   
                "key": "Execution",
                "value": "'$EXECUTION_MODE'"
            }
        ]
    }'

LAUNCH_ID=$(curl -k --location "https://35.226.254.46/api/v1/test-development/launch" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $RP_API_KEY" \
    --data "$REQUEST_BODY" | jq -r '.id')

echo "Reportportal launch ID was created: $LAUNCH_ID"

LAUNCH_ID=$LAUNCH_ID RP_API_KEY=$RP_API_KEY PARALLEL_COUNT=2 CLOUD_QA_API_KEY=$QA_API_KEY yarn cypress:run:qa:serverless:parallel
# LAUNCH_ID=$LAUNCH_ID RP_API_KEY=$RP_API_KEY PARALLEL_COUNT=4 CLOUD_QA_API_KEY=$QA_API_KEY yarn cypress:run:qa:serverless:parallel; status=$?; yarn junit:merge || :; exit $status

curl -k --location --request PUT "https://35.226.254.46/api/v1/test-development/launch/$LAUNCH_ID/finish" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $RP_API_KEY" \
    --data '{
        "endTime": "'$(date -u "+%Y-%m-%dT%H:%M:%S+00:00")'"
    }'
