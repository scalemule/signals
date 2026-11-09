# ScaleMule Signal codes (registry v1)

Generated from `@scalemule/signals` `registry.json` — do not edit by hand. Codes are stable identities;
copy may change, codes never do. Legacy aliases (backend `SCREAMING_SNAKE`, SDK `lowercase_snake`) map to the canonical code.

| Code | Kind | Default scope | Recoverability | Default message | Actions | Agent | Aliases |
|---|---|---|---|---|---|---|---|
| `auth.session.expired` | warning | application | user_action | Your session has expired. Sign in again to continue. | authenticate | observe/explain | `SESSION_EXPIRED` `EXPIRED_SESSION` `session_expired` `token_expired` |
| `auth.session.invalid` | warning | application | user_action | Sign in to continue. | authenticate | — | `INVALID_SESSION` `UNAUTHORIZED` `unauthorized` `invalid_session` |
| `auth.credentials.invalid` | error | — | user_action | The email or password is incorrect. | — | — | `INVALID_CREDENTIALS` `invalid_credentials` |
| `permissions.denied` | error | — | admin_action | You don't have permission to do that. | — | observe/explain | `FORBIDDEN` `forbidden` `permission_denied` `ACCOUNT_SCOPE_REQUIRED` `CREDENTIAL_MODE_CONFLICT` `OPERATION_REQUIRES_SERVER_CREDENTIAL` |
| `network.offline` | warning | system | automatic | You're offline. Reconnecting… | — | observe/explain | — |
| `network.request_failed` | error | — | retry | We couldn't reach the server. Check your connection and try again. | — | observe/explain/suggest/execute | `network_error` `NETWORK_ERROR` |
| `request.timeout` | error | — | retry | The request took too long. Try again. | — | — | `timeout` `TIMEOUT` |
| `validation.invalid_input` | error | — | user_action | Check the highlighted field. | — | — | `INVALID_INPUT` `INVALID_FORMAT` `MISSING_FIELD` `validation_error` `invalid_input` |
| `resource.not_found` | error | — | none | We couldn't find what you were looking for. | — | — | `NOT_FOUND` `RESOURCE_NOT_FOUND` `not_found` `RUN_OUTPUT_EXPIRED` |
| `resource.conflict` | error | — | user_action | This conflicts with an existing item. | — | — | `CONFLICT` `ALREADY_EXISTS` `conflict` `already_exists` `IDEMPOTENCY_KEY_REUSED` |
| `rate_limit.exceeded` | warning | — | retry | Too many requests. Wait a moment and try again. | — | — | `RATE_LIMIT_EXCEEDED` `rate_limited` |
| `quota.exceeded` | warning | — | admin_action | This plan’s limit has been reached. | — | — | `QUOTA_EXCEEDED` `quota_exceeded` |
| `service.unavailable` | error | — | retry | We couldn't complete that. Try again in a moment. | — | — | `INTERNAL_ERROR` `DATABASE_ERROR` `EXTERNAL_SERVICE_ERROR` `internal_error` `service_unavailable` `server_error` |
| `tenant.relocating` | warning | application | retry | This workspace is being moved. Try again shortly. | — | — | `TENANT_RELOCATING` `PLACEMENT_UNAVAILABLE` |
| `ai.run.failed` | error | — | retry | We couldn’t complete this request. Try again. | — | — | `RUN_ATTEMPTS_EXHAUSTED` `RUNTIME_FAILED` `AI_RUN_FAILED` |
| `ai.output.invalid` | error | — | retry | The AI result didn’t match the expected format. Try again. | — | — | `OUTPUT_SCHEMA_INVALID` |
| `ai.approval.required` | info | — | user_action | This action needs an approval before it can continue. | — | — | `AI_APPROVAL_REQUIRED` `waiting_for_approval` |
| `ai.approval.denied` | warning | — | none | The requested action was not approved. | — | — | `APPROVAL_DENIED` |
| `ai.budget.exhausted` | warning | — | admin_action | This workspace’s AI budget for today has been used. Try again tomorrow or raise the limit. | — | — | `BUDGET_EXHAUSTED` |
| `ai.tool.uncertain` | warning | — | admin_action | An action may have been applied but its result couldn’t be confirmed. Check before retrying. | — | — | `TOOL_OUTCOME_UNCERTAIN` |

Total: 20 codes.
