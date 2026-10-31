-- Run after migrations with the schema-owning migration role.
GRANT SELECT ON accounts,migration_runs TO icb_service;
GRANT SELECT,INSERT,UPDATE ON sessions,login_attempts,collector_leases,collector_history,
    viewers,activity_receipts,source_event_receipts,activity_event_receipts,
    support_events,giveaway_audit_events,viewer_daily_stats,stream_daily_stats,support_currency_daily TO icb_service;
GRANT SELECT,INSERT,UPDATE ON feature_state,state_import_runs TO icb_service;
GRANT SELECT ON daily_summary_quality TO icb_service;
GRANT DELETE ON sessions,login_attempts TO icb_service;
