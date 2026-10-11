"""One HTTP route inventory used by local wiring and infrastructure verification."""

ROUTES = [
    ("GET", "/intake"),
    ("GET", "/generators"),
    ("GET", "/generators/{generatorId}"),
    ("GET", "/operations"),
    ("GET", "/submissions"),
    ("POST", "/submissions"),
    ("POST", "/submissions/{submissionId}/screen"),
    ("POST", "/submissions/{submissionId}/photo"),
    ("GET", "/submissions/{submissionId}/evidence"),
    ("GET", "/generators/{generatorId}/readiness"),
    ("POST", "/generators/{generatorId}/hazard-reviews"),
    ("GET", "/generators/{generatorId}/receipts"),
    ("POST", "/plans"),
    ("GET", "/plans/{date}"),
    ("GET", "/plans/{planKey}/details"),
    ("POST", "/plans/{planKey}/dispatch"),
    ("GET", "/plans/{planKey}/driver"),
    ("POST", "/pickups"),
    ("POST", "/gate-logs"),
]
