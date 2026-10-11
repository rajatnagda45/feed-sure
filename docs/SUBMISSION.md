# Submission draft and remaining evidence

Updated 11 October 2026. Draft only; nothing has been published or submitted by Session C.

## Short writeup draft

FeedSure CBG coordinates food-waste collection between enrolled kitchens, one truck and one plant. Kitchens confirm readiness, quantity source and pickup window. The dispatcher plans against full-load capacity and timing constraints, then freezes the route. Drivers record outcomes; plant operators record net intake; kitchens see their own pickup and trip-level reconciliation.

The local prototype executes real Python HTTP/domain handlers and React views with Moto DynamoDB and fallback routing. AWS SAM infrastructure and adapters cover Lambda, API Gateway, DynamoDB, private S3, Bedrock and Amazon Location; frontend hosting configuration targets Amplify. Live AWS deployment and physical-phone camera operation still require evidence. Optional photo/map repairs await final integration verification. OpenAI Codex was used for coding, review, tests and documentation.

All demonstration quantities, kitchens and route scenarios are synthetic. The 18 saved scenarios include 16 ties, one shorter primary route at equal expected quantity, and one trade-off where nearest-first achieves more expected collection. We claim no field savings, photo accuracy, whole-load certification or processing proof. A pilot should measure attributable failed visits, collected quantities and discrepancy resolution with a real collector and kitchens.

## Evidence checklist

| Item | Current status / next evidence |
|---|---|
| Backend regression | Session C: 225 passed on Python 3.13.9 before final map/photo integration; rerun after repairs freeze |
| Frontend regression/build | 22 passed / 3 opt-in skipped; build passed before repair integration |
| Route evaluation | 18 fixed synthetic scenarios reproduced; ties and trade-off retained |
| Photo and map workflow | Independent integration pending both READY handoffs; record real selected bytes, failure/ownership, provider labels and phone-width layout |
| AWS eligibility evidence | Not established by this QA. Obtain genuine AWS open-source-tool execution or deployed service evidence and show it in video; source/IaC, boto3 declarations and Moto alone are insufficient to assert eligibility |
| Real phone | Camera selection/upload and permission behaviour unverified; desktop responsive inspection cannot establish them |
| Public repository | URL, event-window history and licence credits need final review by the owner; project LICENSE file is missing; no push performed |
| AI disclosure | Codex listed; owner must add any other AI tools actually used |
| Video | Script targets 2:45; actual recording, duration and public/unlisted YouTube link pending |
| Team / registration | Owner supplies actual identities and verified registration details; none invented |
| Deadline | Event is 8–11 October 2026; inspect the submission form for exact cut-off, do not assume midnight |
| Submission | Owner reviews final writeup/links and submits once; no submission performed |

The organisers require a public repository, short problem/build/AWS writeup and a YouTube video under three minutes; AWS use must appear in the video. AI coding tools need disclosure. These requirements were checked against the [official rules](https://www.wemakedevs.org/aws/rules) on 11 October 2026. The [event page](https://www.wemakedevs.org/aws/env) allows an AWS open-source tool or AWS deployment for prize eligibility and lists the judging categories. This checklist does not certify eligibility or infer it from code.
