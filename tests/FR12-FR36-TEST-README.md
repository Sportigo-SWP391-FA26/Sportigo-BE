# FR-12 to FR-36 test coverage

This FR-to-test mapping was originally prepared against `G01_Backlog` and `G01_Rules` in `SWP391_Backlog_471.S01.xlsx`. That workbook is not present in the current workspace, so this run verifies the FR mapping recorded here and the user's scope clarification; exact rule-by-rule workbook traceability requires the source workbook.

## Test organization

The existing suite includes both service/schema unit tests and database-backed integration tests. The new tests are grouped by backend module and exercise service logic with a mocked Prisma client. This keeps them runnable without a separate PostgreSQL test database while following the team's `tests/<module>/*.test.ts` organization.

| Backlog requirements | Test file | Covered behavior |
|---|---|---|
| FR-12 | `sports/sport.service.test.ts` | Unique sport names; duplicate rename rejection; prevent hard delete when referenced |
| FR-13 | `rooms/room.service.test.ts` | Unique room code; positive capacity; default AVAILABLE status; prevent deleting scheduled room |
| FR-14 | `coaches/coach.service.test.ts` | Valid time range; overlapping availability rejection; list availability order |
| FR-15–FR-16 | `group-classes/group-class.service.test.ts` | Positive capacity/fee; active sport and qualified coach checks; DRAFT creation; opening validation; coach assignment validation |
| FR-17–FR-19 | `class-sessions/session.service.test.ts`; `bookings/fr12-fr36-api-auth.integration.test.ts` | Single/batch session creation; weekly recurrence expanded to persisted sessions; occurrence-level room/coach/member conflicts; all-or-nothing creation and date boundaries |
| FR-21–FR-24, FR-28 | `bookings/booking.service.test.ts`; `bookings/cancellation-policy.test.ts` | Public listing/detail, registration gates, seat/duplicate checks, cancellation/refund, configurable cutoff boundary tests |
| FR-25–FR-26 | `waitlist/waitlist.service.test.ts`; `bookings/fr12-fr36-api-auth.integration.test.ts` | Full-class gate, duplicate prevention, FIFO offers, offer expiry/promotion, acceptance, concurrent last-seat booking, concurrent offer processing, and cancellation/registration races |
| FR-29 / BR-16 | `private-courses/private-course.schedule.integration.test.ts` | PostgreSQL recurring private schedule conflicts with group sessions for Coach, Member, and room at first, middle, and final occurrences; no partial enrollment writes |
| FR-30–FR-35 | `private-courses/private-course.service.test.ts`; `bookings/fr12-fr36-api-auth.integration.test.ts`; `finance/finance.integration.test.ts` | ACTIVE course/Coach/assignment checks, token-derived Member identity, schedule selection before payment, pending-to-active payment transition and repeated callback protection |
| FR-36 / BR-30 | `private-courses/private-course.service.test.ts`; `private-courses/private-course.attendance.integration.test.ts` | Assigned-Coach authorization; completed-occurrence validation; atomic exactly-once decrement; completion state; migration unique/FK/time checks; concurrent attendance against remaining-session limit |

## Run tests

From the backend root:

```bash
npm ci
npm test
```

Type-check without running tests:

```bash
npm run typecheck
```

Most service tests mock Prisma and do not need `TEST_DATABASE_URL`. The API integration suite, including recurrence persistence and conflict tests, uses the repository's `TEST_DATABASE_URL` safety checks and may reset that isolated test database.

## Remaining work before calling FR-12–FR-36 complete

The current suite passing means only that the tests present in the repository passed. It does not prove every rule in `G01_Rules` is implemented or verified. The items below distinguish missing behavior from behavior that exists but lacks enough verification.

### Functionality still missing or incomplete

| Requirement | Remaining work | Completion evidence |
|---|---|---|
### Implemented behavior that still lacks sufficient verification

| Requirement | Verification gap | Tests/evidence needed |
|---|---|---|
| FR-12–FR-16 | Service unit tests cover core validation, but do not establish the full HTTP contract and role restrictions. | API integration tests for authentication, allowed/denied roles, validation errors, persistence, and response shapes for sports, rooms, coach availability, and group classes. |
| FR-17–FR-19 | Weekly recurrence generation and later-occurrence conflict rejection have database/API coverage; remaining session lifecycle paths are not all end-to-end verified. | Add API/database tests for the in-scope create/list/change behavior and conflicts. FR-20 / BR-21 notification behavior is excluded here because it depends on FR-54. |
| FR-21–FR-29 | Seat capacity, duplicate registration, waitlist offer expiry/promotion, and booking/cancellation races now have database/API coverage; full payment lifecycle and remaining route behaviors still need verification. | API/database tests for receptionist registration, cancellation/refund boundaries, accept/decline flows, and payment activation. |
| FR-30–FR-35 | Core enrollment, schedule, and payment activation have database/API coverage; concurrent purchase races and every administrative course-management route are not exhaustively covered. | Add concurrency and full management-route matrix tests if those paths are in the current release scope. |
| FR-36 / BR-30 | Private-course attendance stores completed occurrences; it has no separate private-course ABSENT/cancelled state in the current schema. Group-class attendance supports PRESENT/ABSENT/LATE/EXCUSED. | Confirm against the authoritative backlog whether private-course absence/cancellation must be stored separately before extending this data model. |
| HTTP error contract (cross-cutting) | Review controllers that may convert service errors to HTTP 400 instead of preserving `HttpError` status/code. | API tests asserting correct 400/403/404/409 statuses and stable error response bodies. |

## Verification snapshot

- The API server runs a 60-second waitlist expiry worker. Expiry and offer promotion share a per-class PostgreSQL row lock with booking, cancellation, offer processing, and acceptance, so repeated worker runs are idempotent and cannot create simultaneous active offers for a class.
- Private-course Members choose recurring schedules when creating a `PENDING_PAYMENT` enrollment. The schedules are persisted with the enrollment/order; adding schedules later requires `ACTIVE`. Full payment activates the enrollment in the common finance finalizer. The legacy full-wallet route now delegates to that transaction.
- `CLASS_CANCELLATION_CUTOFF_HOURS` is the single configurable Member cancellation cutoff (default 48 hours); staff may cancel before class start. A shared helper is tested before, at, and after the boundary. The 48-hour default preserves the existing service behavior; the backlog workbook was not present in this workspace, so confirm that policy against the authoritative FR/BR source before release.
- Added `20261023230000_coach_sport_qualification` after fresh-database integration exposed that `CoachSport` existed in Prisma schema without a migration. Attendance and CoachSport migration constraints are checked on PostgreSQL; global setup applies migrations to isolated `TEST_DATABASE_URL`.
- Test matrix: unit (cutoff/private-course/finance rules); integration (PostgreSQL persistence, transactions, migration constraints); API (token identity, role and HTTP status); recurrence (first/middle/last conflict occurrences); concurrency (booking/waitlist/attendance races); regression (full `npm test` suite).
- FR-20 / BR-21 session-change notifications are intentionally excluded from this FR-12–FR-36 verification: as clarified by the user, Manager change/cancel notifications belong to FR-54.
- Scoped FR-12–FR-36 command passed: **17 test files, 105 tests passed, no TODO**. It covers the feature unit suites, booking/private-course/finance APIs, database-backed persistence and migration checks, recurrence boundaries, and concurrency scenarios.

The full regression suite previously passed on 2026-10-23 after resetting and replaying migrations on the isolated local `sportigo_fr_test` database: **27 test files passed; 197 executable tests passed**. The `it.todo` entries in `fr12-fr36-implementation-gaps.test.ts` are checklist markers for incomplete or unverified coverage, not passing test assertions. BR-06 is outside this FR-12–FR-36 scope and is not counted as a gap here. Integration runs reset data in the configured isolated test database.

The scoped FR-12–FR-36 test command passed with **17 files and 105 executable tests** before this checklist was restored. Re-run it after checklist updates; checklist TODOs are deliberately not counted as test evidence.

## Phase 1 API endpoint and access matrix

The following matrix reflects the routers mounted by `src/routes/index.ts` and their nested route modules. `Public` means no access token is required. All other roles require a valid Bearer token. Expected error statuses use `400` for invalid input, `401` for missing/invalid authentication, `403` for role/ownership denial, `404` for missing resources, and `409` for business conflicts.

| Mounted endpoint(s) | FR/BR | Allowed role(s) | Expected success | Important denial/error cases |
|---|---|---|---|---|
| `GET /api/sports`; `POST /api/sports`; `PUT /api/sports/:id`; `DELETE /api/sports/:id` | FR-12 | Read: all authenticated roles; writes: CENTER_MANAGER | 200 / 201 | 401 unauthenticated; 403 non-manager write; 400 invalid data; 404 missing ID; 409 duplicate/in-use |
| `GET /api/rooms`; `POST /api/rooms`; `PUT /api/rooms/:id`; `DELETE /api/rooms/:id` | FR-13 | Read: all authenticated roles; writes: CENTER_MANAGER | 200 / 201 | 401; 403; 400 invalid capacity/data; 404 missing ID; 409 duplicate/in-use |
| `GET /api/coaches/:id/availability`; `POST /api/coaches/:id/availability` | FR-14 | Read: all authenticated roles; write: CENTER_MANAGER | 200 / 201 | 401; 403; 400 invalid date/time; 404 missing coach; 409 overlapping availability |
| `GET /api/group-classes`; `POST /api/group-classes`; `PATCH /api/group-classes/:id/status`; `PATCH /api/group-classes/:id/coach` | FR-15–FR-16 | CENTER_MANAGER | 200 / 201 | 401; 403; 400 invalid input; 404 missing class; 409 inactive/unqualified coach or schedule conflict |
| `GET /api/group-classes/:id/sessions`; `POST /api/group-classes/:id/sessions`; `POST /api/group-classes/:id/sessions/recurring`; `POST /api/class-sessions`; `POST /api/class-sessions/:id/change` | FR-17–FR-19 (FR-20 / BR-21 notification excluded; notification behavior belongs to FR-54) | Read: all authenticated roles; writes: CENTER_MANAGER | 200 / 201 | 401; 403; 400 invalid input; 404 missing class/session; 409 room/coach/member/date conflict |
| `GET /api/bookings/classes`; `GET /api/bookings/classes/:id` | FR-21–FR-22 | Public | 200 | 404 missing or non-public class; invalid query should be 400 |
| `POST /api/bookings/classes/:id/register`; `POST /api/bookings/registrations/:id/cancel` | FR-23–FR-24, FR-28 | Register: MEMBER; cancel: owning MEMBER or RECEPTIONIST | 201 / 200 | 401; 403 wrong role/foreign registration; 404 missing class/registration; 409 closed/full/already started/cutoff |
| `POST /api/group-classes/:id/waitlist`; `POST /api/group-classes/:id/waitlist/respond` | FR-25–FR-26 | MEMBER | 201 / 200 | 401; 403 wrong role/foreign offer; 404 missing class/offer; 409 class not full, duplicate, or expired offer |
| `POST /api/group-classes/:id/register-on-behalf`; `POST /api/group-classes/:id/cancel` | FR-27–FR-28 | RECEPTIONIST; CENTER_MANAGER | 201 / 200 | 401; 403 wrong role; 400 invalid target; 404 missing resource; 409 business conflict |
| `POST /api/private-courses`; `PATCH /api/private-courses/:id`; `POST /api/private-courses/:id/coaches`; `DELETE /api/private-courses/:id/coaches/:coachId` | FR-30–FR-32 | CENTER_MANAGER | 201 / 200 | 401; 403; 400 invalid course/price; 404 missing course/assignment; 409 invalid state/conflict |
| `GET /api/private-courses`; `POST /api/private-courses/:id/enroll`; `POST /api/private-courses/enrollments` | FR-30–FR-35 | Read: MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER; enroll: MEMBER | 200 / 201 | 401; 403; 400 invalid request; 404 missing course; 409 Coach/Member/room conflict |
| `GET /api/private-courses/enrollments`; `GET /api/private-courses/enrollments/:id`; `POST /api/private-courses/enrollments/:id/schedules` | FR-33–FR-36 | List/detail: MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER with ownership filtering; add schedule: MEMBER owner; mark attendance: assigned COACH | 200 / 201 | 401; 403 wrong role/foreign resource; 400 invalid ID/date; 404 missing enrollment/schedule; 409 invalid state/duplicate/conflict |
| `POST /api/private-courses/enrollments/:id/schedules/:scheduleId/attendance` | FR-36 / BR-30 | Assigned COACH | 200 | 401; 403 wrong role/Coach; 400 invalid date; 404 missing schedule; 409 session not complete/already exhausted |
| `/api/orders/:id/payments/*`; `/api/orders/:id/wallet-payments`; order/promotion/refund/invoice routes | FR-23–FR-29, finance BRs | MEMBER for own order/payment requests; RECEPTIONIST for cash collection; CENTER_MANAGER for refund review/reports | 200 / 201 | 401; 403 wrong role/foreign order; 404 missing resource; 409 order/payment state conflict |
| `GET /api/sessions/:sessionId/attendance`; `POST /api/sessions/:sessionId/check-in` (legacy attendance routes) | Attendance BRs | Read: assigned COACH or CENTER_MANAGER; check-in: assigned COACH | 200 | 401; 403 wrong role/Coach; 404 missing session; 409 non-confirmed registration |
| `GET /api/reports/revenue`; `GET /api/reports/attendance`; finance report/export and audit routes | Reporting BRs | CENTER_MANAGER | 200 | 401; 403 wrong role; 400 invalid filters |
| `/api/class-sessions/:id/attendance` GET/PUT; `/api/attendance`; `/api/workout-plans*`; `/api/private-enrollments/:id/plans`; `/api/progress-assessments`; `/api/members/me/training` | FR-47–FR-53, BR-42–BR-48 | As declared in the corresponding `src/modules/training/*.routes.ts` files: Coach/Manager for attendance writes/reports and plan management; Member for personal history; assigned Coach/Member/Manager for plan assignments | 200 / 201 | 401; 403 role/ownership; 404 missing resource; 400 invalid input |
| `/api/auth/*`; `/api/payments/vnpay/return`; `/api/payments/vnpay/ipn`; `/health`; `/api-docs` | Authentication/payment callbacks | Public by design; callbacks must validate provider signatures | 200 / 201 or callback-specific response | Invalid credentials/signature rejected; callbacks are not ordinary user-authenticated endpoints |

### Complete router mount inventory

`src/routes/index.ts` mounts the following route modules. The paths below include the prefixes added by the mount point:

| Route module | Mounted paths |
|---|---|
| `auth/auth.routes.ts` at `/api/auth` | `POST /login`, `/register`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/google`, `/refresh`, `/logout` |
| `training/attendance.routes.ts` | `GET/PUT /api/class-sessions/:id/attendance`; `GET /api/attendance` |
| `training/workout-plan.routes.ts` | `GET/POST /api/workout-plans`; `GET/PATCH/DELETE /api/workout-plans/:id`; `PATCH /api/workout-plans/:id/status` |
| `training/workout-plan-item.routes.ts` | `GET/POST /api/workout-plans/:id/items`; `PATCH /api/workout-plans/:id/items/reorder`; `PATCH/DELETE /api/workout-plans/:id/items/:itemId` |
| `training/plan-assignment.routes.ts` | `GET/POST /api/private-enrollments/:id/plans` |
| `training/progress-assessment.routes.ts` | `GET/POST /api/progress-assessments` |
| `training/member-training.routes.ts` | `GET /api/members/me/training` |
| `training/training.routes.ts` (parent) | Mounts the six nested training routers above; it does not add its own endpoint. |
| `finance/finance.routes.ts` | `GET /api/payments/vnpay/return`, `/api/payments/vnpay/ipn`, `/api/orders/:id`, `/api/payments`, `/api/refund-requests`, `/api/promotions`, `/api/reports/revenue`, `/api/reports/revenue/export`, `/api/reports/classes`, `/api/reports/classes/export`, `/api/audit-logs`, `/api/invoices/:id/pdf`; `POST /api/orders/:id/promotion`, `/api/orders/:id/payments/vnpay`, `/api/orders/:id/payments/cash`, `/api/orders/:id/wallet-payments`, `/api/payments/:id/refund-requests`, `/api/promotions`; `PATCH /api/refund-requests/:id/review`, `/api/promotions/:id`; `POST /api/refund-requests/:id/complete` |
| `sports/sport.routes.ts` at `/api/sports` | `GET/POST /`; `PUT/DELETE /:id` |
| `rooms/room.routes.ts` at `/api/rooms` | `GET/POST /`; `PUT/DELETE /:id` |
| `coaches/coach.routes.ts` at `/api/coaches` | `GET/POST /:id/availability` |
| `group-classes/group-class.routes.ts` at `/api/group-classes` | `GET/POST /`; `PATCH /:id/status`, `PATCH /:id/coach`; `GET/POST /:id/sessions`; `POST /:id/cancel`, `POST /:id/register-on-behalf` |
| `class-sessions/session.routes.ts` at `/api/class-sessions` | `POST /`; `POST /:id/change` |
| `bookings/booking.routes.ts` at `/api/bookings` | Public `GET /classes`, `/classes/:id`; protected `POST /classes/:id/register`, `/registrations/:id/cancel` |
| `waitlist/waitlist.routes.ts` also at `/api/group-classes` | `POST /:id/waitlist`, `POST /:id/waitlist/respond` |
| `private-courses/private.routes.ts` at `/api/private-courses` | `GET/POST /`; `PATCH /:id`; `POST /:id/coaches`, `POST /:id/enroll`; `DELETE /:id/coaches/:coachId`; `GET /enrollments`, `GET /enrollments/:id`; `POST /enrollments`, `/enrollments/:id/schedules`, `/enrollments/:id/schedules/:scheduleId/attendance` |
| `attendance/attendance.routes.ts` | `GET /api/sessions/:sessionId/attendance`; `POST /api/sessions/:sessionId/check-in` |
| `reports/report.routes.ts` | `GET /api/reports/attendance` |
| `src/app.ts` | Public `GET /health`; Swagger UI at `/api-docs` |

Phase 1 integration coverage is in `bookings/fr12-fr36-api-auth.integration.test.ts`. It sends unauthenticated requests to every protected FR-12–FR-36 and adjacent mounted endpoint in the inventory to prove the route is mounted and returns 401. Additional cases cover wrong roles, owner vs. foreign Member/Coach access, manager writes, server-derived payment/attendance actors, public discovery, and representative 400/403/404/409 responses. This verifies the access gates and representative ownership paths; it does not replace a success/business-flow integration test for every endpoint.
