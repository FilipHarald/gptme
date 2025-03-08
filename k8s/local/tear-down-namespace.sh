#!/bin/bash
set -e

NAMESPACE=${1:-gptmingdom}

echo "Tearing down namespace: $NAMESPACE"

kubectl delete pods --all -n gptmingdom
