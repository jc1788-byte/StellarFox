# AWS cost monitoring

This optional CloudFormation stack adds account-level monthly cost budgets (50%,
80%, and 100% actual spend, plus a 100% forecast), daily AWS Cost Anomaly
Detection notifications, and a daily Compute Optimizer email report for
over-provisioned EC2 instances and non-optimized EBS volumes.

Deploy once per AWS account. Budgets and Cost Anomaly Detection monitor account
spend; the recommendation report covers the stack's deployment region. Before
deploying:

1. Enable AWS Cost Explorer and enroll the account in AWS Compute Optimizer in
   the region where the stack will run.
2. Use a deployment identity allowed to create CloudFormation stacks, IAM roles,
   Lambda functions, EventBridge rules, SNS topics/subscriptions, CloudWatch log
   groups, AWS Budgets, and Cost Anomaly Detection resources.
3. Confirm the SNS email subscription for the recommendation report after
   deployment. Budget and anomaly notifications are delivered directly by their
   AWS services.

Deploy with the AWS CLI:

```sh
aws cloudformation deploy \
  --template-file infra/aws/cost-monitoring.yaml \
  --stack-name stellarfox-cost-monitoring \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AlertEmail=ops@example.com \
    MonthlyBudgetUsd=500 \
    AnomalyThresholdUsd=10
```

Budget notifications are monthly percentages of the account's USD budget. The
anomaly threshold is a minimum daily anomalous spend in USD. The scheduled
report calls Compute Optimizer for EC2 and EBS recommendations in the stack's
region, includes estimated monthly savings when AWS provides them, and reports
collection errors to the same email address. Recommendations are informational;
the stack does not resize or modify workloads.

CloudFormation creates IAM permissions scoped to the recommendation APIs and
the report's SNS topic. Review the budget and anomaly settings against the
account's billing requirements before deployment.
