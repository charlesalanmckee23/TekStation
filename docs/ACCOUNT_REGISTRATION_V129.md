# TekStation v129 — Registration reliability

Registration now treats account/session creation as the critical operation. Recovery-key setup and initial cloud backup are best-effort follow-up work so a successful account cannot be reported as HTTP 500 because an optional secondary step failed.

Welcome-email delivery is also explicitly non-blocking through the Worker waitUntil task.
