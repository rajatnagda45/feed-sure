# Submission draft and remaining evidence

Updated 11 October 2026. Draft only; nothing has been published or submitted by Session C.

## Hackathon implementation review — 11 October 2026

**Assessment: 7/10 as a hackathon prototype; submission readiness is incomplete.** This is an engineering assessment, not an official judging score or weighted average. The organisers publish five qualitative criteria and no numeric weights.

| Official criterion | Assessment | Evidence and remaining gap |
|---|---|---|
| Idea and impact | 8/10 | Clear Waste and Energy use case: coordinate source-segregated food waste from hotels, hostels, PGs, canteens and organisations to a CBG plant. Field impact and customer demand remain unvalidated. |
| Built on AWS | Unverified eligibility evidence | SAM and AWS adapters are implemented. The verified runtime uses Moto and fallback routing; demonstrate an eligible AWS open-source tool or live AWS services in the video. |
| Design and usability | 7/10, provisional | Separate supplier, admin, owner and driver surfaces; explicit missing/error states. Owner interaction and an unfamiliar-user walkthrough remain unverified. |
| Execution | 8/10 locally | Readiness, feasible planning, frozen dispatch, pickups, gate corrections and shared records are implemented. Last full verified baseline: 280 backend and 62 frontend tests passed; 3 opt-in frontend tests skipped. |
| Demo video | Pending | A 2:45 script exists, but no final public/unlisted YouTube recording was verified. Show the complete collection loop and genuine AWS use. |

The GitHub repository `rajatnagda45/feed-sure` was checked and is **private**. The rules require a public repository, a short writeup and a YouTube video under three minutes. Before submission, resolve repository visibility, record the demo with AWS evidence, and verify registration/team details and final links. Review dependency attribution and licensing; this checkout has no project LICENSE file. Visibility and licensing changes require the repository owner's decision.

Sources: [official judging criteria and AWS eligibility](https://www.wemakedevs.org/aws/env), [submission rules](https://www.wemakedevs.org/aws/env/rules). “Waste supplier” is the participant-facing term; this pilot still accepts enrolled food-waste streams, not arbitrary organic materials.

## Short writeup draft

FeedSure CBG coordinates food-waste collection between hotels, hostels, PG owners, canteens and other enrolled bulk food-waste suppliers, one truck and one plant. Waste suppliers confirm readiness, quantity source and pickup window. The dispatcher plans against full-load capacity and timing constraints, then freezes the route. Drivers record outcomes; plant owners use a separate intake interface; suppliers see their own pickup and trip-level reconciliation.

The local prototype executes real Python HTTP/domain handlers and React views with Moto DynamoDB and fallback routing. AWS SAM infrastructure and adapters cover Lambda, API Gateway, DynamoDB, private S3, Bedrock and Amazon Location; frontend hosting configuration targets Amplify. Live AWS deployment and physical-phone camera operation still require evidence. Optional photo/map repairs await final integration verification. OpenAI Codex was used for coding, review, tests and documentation.

All demonstration quantities, waste suppliers and route scenarios are synthetic. The 18 saved scenarios include 16 ties, one shorter primary route at equal expected quantity, and one trade-off where nearest-first achieves more expected collection. We claim no field savings, photo accuracy, whole-load certification or processing proof. A pilot should measure attributable failed visits, collected quantities and discrepancy resolution with a real collector and waste suppliers.

## Evidence checklist

| Item | Current status / next evidence |
|---|---|
| Backend regression | Latest owner-interface baseline: 280 passed; see TESTING.md |
| Frontend regression/build | Latest owner-interface baseline: 62 passed / 3 opt-in skipped; production build passed |
| Route evaluation | 18 fixed synthetic scenarios reproduced; ties and trade-off retained |
| Photo and map workflow | Independent integration pending both READY handoffs; record real selected bytes, failure/ownership, provider labels and phone-width layout |
| AWS eligibility evidence | Not established by this QA. Obtain genuine AWS open-source-tool execution or deployed service evidence and show it in video; source/IaC, boto3 declarations and Moto alone are insufficient to assert eligibility |
| Real phone | Camera selection/upload and permission behaviour unverified; desktop responsive inspection cannot establish them |
| Public repository | GitHub currently reports PRIVATE; merged implementation PRs exist. Public access, event-window history and licence credits need final review; project LICENSE file is missing |
| AI disclosure | Codex listed; owner must add any other AI tools actually used |
| Video | Script targets 2:45; actual recording, duration and public/unlisted YouTube link pending |
| Team / registration | Owner supplies actual identities and verified registration details; none invented |
| Deadline | Event is 8–11 October 2026; inspect the submission form for exact cut-off, do not assume midnight |
| Submission | Owner reviews final writeup/links and submits once; no submission performed |

The organisers require a public repository, short problem/build/AWS writeup and a YouTube video under three minutes; AWS use must appear in the video. AI coding tools need disclosure. These requirements were checked against the [official rules](https://www.wemakedevs.org/aws/rules) on 11 October 2026. The [event page](https://www.wemakedevs.org/aws/env) allows an AWS open-source tool or AWS deployment for prize eligibility and lists the judging categories. This checklist does not certify eligibility or infer it from code.
