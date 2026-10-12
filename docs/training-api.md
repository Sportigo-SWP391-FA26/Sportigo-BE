# Training API (FR-47 → FR-53)

Module Training gồm điểm danh buổi học, giáo án, gán giáo án cho khóa 1-1, đánh giá tiến độ và trang "Kế hoạch & tiến độ của tôi". Mã nguồn nằm trong `src/modules/training/`. Tài liệu đầy đủ từng trường xem ở Swagger: `http://localhost:3000/api-docs` (các tag `Training – …`).

## 1. Chạy local

1. Sao chép `.env.example` thành `.env`, điền `DATABASE_URL` và `TEST_DATABASE_URL` trỏ PostgreSQL trên máy (không dùng Supabase dùng chung).
2. `npm ci` → `npx prisma migrate deploy` → `npm run db:seed` → `npm run dev`.
3. Lệnh seed in ra bảng ID demo (Coach, Member, buổi học, enrollment, giáo án). Dùng các ID đó khi gọi API.

Biến cấu hình riêng của module: `ATTENDANCE_EDIT_WINDOW_HOURS` (mặc định 24) là số giờ sau khi buổi học kết thúc mà Coach vẫn được sửa điểm danh.

## 2. Quy ước chung

- **Xác thực:** header `Authorization: Bearer <accessToken>`, lấy token từ `POST /api/auth/login`. Thiếu hoặc sai token trả `401 UNAUTHENTICATED`; sai role trả `403 FORBIDDEN` với thông báo BR-06 "Bạn không có quyền thực hiện thao tác này."
- **Thành công:** trả thẳng dữ liệu (không bọc envelope), theo đúng quy ước hiện có của repo.
- **Lỗi:** `{ "code": "MA_LOI", "message": "Thông báo tiếng Việt", "details": ... }`. Lỗi validate trả `422 VALIDATION_ERROR`, `details.fieldErrors` liệt kê lỗi theo từng trường.
- **Phân trang:** query `page` (mặc định 1) và `pageSize` (mặc định 20, tối đa 100). Kết quả có dạng `{ items, page, pageSize, total }`.
- **Ngày giờ:** trường thời điểm dùng ISO 8601 UTC; trường chỉ có ngày (`assessmentDate`, `startDate`…) dùng `YYYY-MM-DD`. "Hôm nay" tính theo giờ `Asia/Ho_Chi_Minh`.

## 3. Danh sách endpoint

Tiền tố chung `/api`.

| FR | Method & path | Role | Mô tả | BR |
|---|---|---|---|---|
| 47 | `PUT /class-sessions/:id/attendance` | COACH phụ trách lớp | Điểm danh hàng loạt, upsert, một transaction | BR-42, BR-43 |
| 47 | `GET /class-sessions/:id/attendance` | COACH phụ trách lớp, CENTER_MANAGER | Học viên CONFIRMED kèm trạng thái điểm danh (`null` nếu chưa) | BR-42 |
| 48 | `GET /attendance` | MEMBER, COACH, CENTER_MANAGER | Lịch sử điểm danh, lọc `classId, memberId, sessionId, status, from, to` | — |
| 49 | `GET /workout-plans` | COACH, CENTER_MANAGER | Lọc `sportId, level, status, search` | — |
| 49 | `POST /workout-plans` | COACH | Tạo giáo án (DRAFT) theo một môn đang hoạt động | BR-44 |
| 49 | `GET /workout-plans/:id` | COACH, CENTER_MANAGER | Chi tiết kèm mục (tuần → buổi → thứ tự) | — |
| 49 | `PATCH /workout-plans/:id` | COACH (mọi Coach) | Sửa; không đổi môn nếu đã từng được gán | BR-44 |
| 49 | `PATCH /workout-plans/:id/status` | COACH | DRAFT/ACTIVE/INACTIVE; ACTIVE khi có ≥ 1 mục | — |
| 49 | `DELETE /workout-plans/:id` | COACH | Xóa mềm → INACTIVE | — |
| 50 | `GET /workout-plans/:id/items` | COACH, CENTER_MANAGER | Danh sách mục | — |
| 50 | `POST /workout-plans/:id/items` | COACH | Thêm mục; bỏ trống `itemOrder` thì xếp cuối | BR-45 |
| 50 | `PATCH /workout-plans/:id/items/:itemId` | COACH | Sửa mục | BR-45 |
| 50 | `DELETE /workout-plans/:id/items/:itemId` | COACH | Xóa mục, đánh lại thứ tự liên tục | BR-45 |
| 50 | `PATCH /workout-plans/:id/items/reorder` | COACH | Sắp xếp lại một tuần/buổi | BR-45 |
| 51 | `POST /private-enrollments/:id/plans` | COACH phụ trách enrollment | Gán giáo án ACTIVE cùng môn | BR-44 |
| 51 | `GET /private-enrollments/:id/plans` | COACH phụ trách, MEMBER chủ enrollment, CENTER_MANAGER | Giáo án đã gán | — |
| 52 | `POST /progress-assessments` | COACH | Ghi đánh giá, đúng một ngữ cảnh | BR-46 |
| 52 | `GET /progress-assessments` | COACH (đánh giá của mình), CENTER_MANAGER | Lọc `memberId` | — |
| 53 | `GET /members/me/training` | MEMBER | Giáo án được gán và đánh giá của chính mình, chỉ đọc | — |

## 4. Mã lỗi nghiệp vụ

| HTTP | `code` | Khi nào | Thông báo |
|---|---|---|---|
| 409 | `ATTENDANCE_LOCKED` | Buổi/lớp đã hủy, buổi chưa bắt đầu, hoặc quá hạn sửa | BR-43: "Bản ghi điểm danh không hợp lệ hoặc buổi học đã khóa dữ liệu." |
| 422 | `REGISTRATION_NOT_ELIGIBLE` | Registration không CONFIRMED hoặc không thuộc lớp của buổi; `details.invalidRegistrationIds` | BR-42: "Học viên chưa đăng ký hợp lệ cho buổi học này." |
| 422 | `SPORT_NOT_AVAILABLE` | Môn không tồn tại hoặc ngừng hoạt động | "Môn thể thao không tồn tại hoặc đã ngừng hoạt động" |
| 409 | `PLAN_SPORT_LOCKED` | Đổi môn của giáo án đã từng được gán | "Không thể đổi môn của giáo án đã được gán cho học viên" |
| 422 | `PLAN_HAS_NO_ITEMS` | Kích hoạt giáo án chưa có mục | "Giáo án phải có ít nhất một mục trước khi kích hoạt" |
| 422 | `DURATION_TOO_SHORT` / `WEEK_OUT_OF_RANGE` | Thời lượng nhỏ hơn tuần của mục / tuần vượt thời lượng | (kèm số tuần) |
| 409 | `DUPLICATE_ITEM_ORDER` | Trùng (tuần, buổi, thứ tự) | BR-45: "Thứ tự mục giáo án bị trùng." |
| 422 | `REORDER_INCOMPLETE` / `ITEMS_NOT_SAME_SLOT` / `ITEM_NOT_IN_PLAN` | Reorder thiếu mục, khác tuần/buổi, mục không thuộc giáo án | (mô tả cụ thể) |
| 409 | `PLAN_NEEDS_ITEMS` | Xóa mục cuối của giáo án ACTIVE | "Không thể xóa mục cuối cùng của giáo án đang hoạt động" |
| 422 | `PLAN_NOT_ASSIGNABLE` | Giáo án sai môn hoặc chưa ACTIVE | BR-44: "Giáo án không cùng môn hoặc chưa được kích hoạt." |
| 409 | `ENROLLMENT_NOT_ACTIVE` | Enrollment chưa ACTIVE | "Khóa học 1-1 chưa ở trạng thái ACTIVE nên chưa thể gán giáo án" |
| 409 | `PLAN_ALREADY_ASSIGNED` | Gán trùng giáo án đang ACTIVE | "Giáo án này đang được gán cho khóa học" |
| 403 | `ASSESSMENT_CONTEXT_INVALID` | Ngữ cảnh không thuộc Member hoặc Coach không phụ trách | BR-46: "Coach không phụ trách học viên hoặc ngữ cảnh đánh giá không hợp lệ." |
| 404 | `NOT_FOUND` | Không tìm thấy buổi học, giáo án, mục, enrollment | (tên đối tượng) |

## 5. Ví dụ

**FR-47: điểm danh** `PUT /api/class-sessions/5/attendance`

```json
{
  "records": [
    { "classRegistrationId": 31, "status": "PRESENT" },
    { "classRegistrationId": 32, "status": "LATE", "note": "Đến muộn 10 phút" }
  ]
}
```

`200`: `{ "sessionId": 5, "records": [{ "id": 90, "registrationId": 31, "status": "PRESENT", "markedById": 4, ... }] }`. Gửi lại cùng registration thì cập nhật bản ghi cũ (cùng `id`). Một registration sai làm cả request bị từ chối, không ghi bản ghi nào.

**FR-49: tạo giáo án** `POST /api/workout-plans`

```json
{ "sportId": 1, "name": "Bơi ếch nền tảng 4 tuần", "level": "BEGINNER", "durationWeeks": 4 }
```

`level` thuộc `BEGINNER | INTERMEDIATE | ADVANCED`. `201` trả giáo án ở trạng thái `DRAFT`, kèm `sport`, `createdBy`, `itemCount`, `assignmentCount`.

**FR-50: thêm mục và sắp xếp**

```json
POST /api/workout-plans/3/items
{ "weekNumber": 1, "sessionNumber": 1, "title": "Khởi động", "content": "Xoay khớp, bơi nhẹ 200m", "durationMinutes": 10, "intensity": "LOW" }

PATCH /api/workout-plans/3/items/reorder
{ "items": [{ "itemId": 23, "itemOrder": 1 }, { "itemId": 21, "itemOrder": 2 }, { "itemId": 22, "itemOrder": 3 }] }
```

Reorder phải gửi đủ mọi mục của một tuần/buổi, với thứ tự 1..n liên tục.

**FR-51: gán giáo án** `POST /api/private-enrollments/15/plans` với body `{ "workoutPlanId": 3 }` trả `201`: `{ "id": 7, "status": "ACTIVE", "assignedAt": "...", "workoutPlan": {...}, "assignedBy": {...} }`.

**FR-52: đánh giá tiến độ** `POST /api/progress-assessments`

```json
{
  "memberId": 12,
  "privateEnrollmentId": 15,
  "assessmentDate": "2026-10-10",
  "coachComment": "Kỹ thuật thở tiến bộ rõ, cần tăng sức bền.",
  "metrics": { "speed": 7, "technique": 8 },
  "score": 8.5,
  "recommendation": "Bơi thêm 2 buổi sức bền mỗi tuần",
  "nextAssessmentDate": "2026-11-10"
}
```

Gửi đúng một trong `classRegistrationId` hoặc `privateEnrollmentId`. Response có `context.type` là `GROUP_CLASS` hoặc `PRIVATE_COURSE`.

**FR-53** `GET /api/members/me/training` trả `{ "planAssignments": [...], "assessments": [...] }`. Mỗi assignment kèm giáo án, các mục, khóa 1-1 và Coach.

## 6. Demo bằng Postman (dữ liệu seed)

Chạy `npm run db:seed` ngay trước buổi demo: lệnh này dời "buổi đang diễn ra" về thời điểm hiện tại. Mật khẩu mọi tài khoản demo là `ChangeMe123!`.

1. `POST /api/auth/login` với `{ "identifier": "coach.demo@sportcenter.local", "password": "ChangeMe123!" }`. Copy `accessToken` vào tab Authorization → Bearer Token. Làm tương tự cho `member1.demo@...` và `member2.demo@...`.
2. **FR-47.** Coach gọi `GET /api/class-sessions/<buổi đang diễn ra>/attendance` để lấy `registrationId`, rồi `PUT` cùng URL với 2 bản ghi. Gửi lại với trạng thái khác để thấy bản ghi được cập nhật, không tạo mới. `PUT` vào "buổi sắp tới" trả `409`.
3. **FR-48.** Member 1 gọi `GET /api/attendance` và chỉ thấy bản ghi của mình. Coach gọi cùng endpoint và thấy cả lớp.
4. **FR-49/50.** Coach gọi `GET /api/workout-plans?sportId=<môn>`, rồi `POST /api/workout-plans/<giáo án>/items` với `{ "weekNumber": 1, "sessionNumber": 1, "itemOrder": 1, "title": "X", "content": "Y" }`. Kết quả là `409` vì trùng thứ tự (BR-45).
5. **FR-51.** Coach gọi `POST /api/private-enrollments/<enrollment>/plans` với `{ "workoutPlanId": <giáo án> }` và nhận `201`. Gửi lại lần nữa nhận `409`. Member 2 gọi `GET` cùng URL nhận `403`.
6. **FR-52.** Coach gọi `POST /api/progress-assessments` với `memberId` của Member 1 và `privateEnrollmentId` của enrollment, nhận `201`. Đổi `memberId` sang Member 2 nhận `403` (BR-46).
7. **FR-53.** Member 1 gọi `GET /api/members/me/training` và thấy giáo án vừa gán cùng đánh giá vừa ghi.

## 7. Test tự động

`npm test` chạy unit test và integration test (Vitest + Supertest):

- Integration test chạy trên `TEST_DATABASE_URL`. Tên database phải chứa `test`, vì test xóa sạch dữ liệu.
- Nếu chưa cấu hình `TEST_DATABASE_URL`, integration test được bỏ qua và có cảnh báo.
- Tên mỗi test bắt đầu bằng mã FR/BR, ví dụ `FR-47 / BR-42: …`.
- File test nằm trong `tests/training/`; dữ liệu mẫu tạo bằng `tests/training/fixtures.ts`.

## 8. Đối chiếu FR → endpoint → code → test

| FR | Endpoint | Code (`src/modules/training/`) | Test (`tests/training/`) | Commit code / test |
|---|---|---|---|---|
| FR-47 | `PUT`, `GET /class-sessions/:id/attendance` | `attendance.*` | `attendance.test.ts` (14 test) | `7d0d7bc` / `6322be4` |
| FR-48 | `GET /attendance` | `attendance.*` | `attendance-history.test.ts` (9) | `2cd7cef` / `b3fb1ec` |
| FR-49 | `/workout-plans`, `/:id`, `/:id/status` | `workout-plan.*` | `workout-plan.test.ts` (15) | `f90cc16` / `e7c97ea` |
| FR-50 | `/workout-plans/:id/items…` | `workout-plan-item.*` | `workout-plan-item.test.ts` (13) | `f68f36c` / `10a87ac` |
| FR-51 | `/private-enrollments/:id/plans` | `plan-assignment.*` | `plan-assignment.test.ts` (10) | `7c4e27c` / `7c5b3ff` |
| FR-52 | `/progress-assessments` | `progress-assessment.*` | `progress-assessment.test.ts` (12) | `8e88622` / `8287243` |
| FR-53 | `GET /members/me/training` | `member-training.*` | `member-training.test.ts` (6) | `e844c95` / `3a9328f` |

Các commit dùng chung cho mọi FR:

| Commit | Nội dung |
|---|---|
| `fa4ba93` | Schema + migration `training_module` |
| `fdfa3d2` | Middleware `src/middleware/auth.ts` |
| `5cb829f` | Hạ tầng test |
| `5d78e07` | Test middleware |
| `b2c94d0` | Seed demo |
| `72c2bb8` | Gộp `develop` (FR-01, FR-02) vào nhánh |
| `6f0620d` | Đổi tên migration thành `20261012170000_training_module` để chạy sau migration FR-02; seed demo đặt `emailVerifiedAt` |

Dữ liệu dùng chung của module nằm ở `training.common.ts` (thông báo BR, phân trang, transaction) và `training.openapi.ts` (Swagger).

## 9. Giả định đã áp dụng

- "Coach phụ trách" một buổi học là `GroupClass.coachId` tại thời điểm thao tác; không lưu lịch sử đổi Coach.
- Khóa điểm danh khi buổi hoặc lớp `CANCELLED`, khi buổi chưa bắt đầu, hoặc khi đã quá `endsAt + ATTENDANCE_EDIT_WINDOW_HOURS`.
- Giáo án là tài nguyên dùng chung: mọi Coach được sửa, Center Manager chỉ xem. "Xóa" là chuyển `INACTIVE`; trạng thái `ARCHIVED` không dùng.
- `level` lưu dạng chuỗi trong DB, API chỉ nhận `BEGINNER | INTERMEDIATE | ADVANCED`.
- Một khóa 1-1 được có nhiều giáo án cùng lúc; chỉ chặn gán trùng một giáo án đang ACTIVE. Gán lại giáo án đã kết thúc thì kích hoạt lại bản ghi cũ (vì có ràng buộc `unique(enrollmentId, workoutPlanId)`).
- Chỉ đánh giá được khóa 1-1 đang `ACTIVE` hoặc đã `COMPLETED`, và chỉ đánh giá được registration `CONFIRMED`.
- Ở `GET /progress-assessments`, Coach chỉ thấy đánh giá do chính mình ghi.
- FR-53 chỉ hiển thị gán `ACTIVE`/`COMPLETED`; gán `CANCELLED` bị ẩn.

## 10. Mâu thuẫn tài liệu và việc cần nhóm quyết định

**Nhóm cần quyết định:**
- **BR-30 ↔ FR-47:** BR-30 liệt kê FR-47 (trừ `remainingSessions` khi hoàn thành buổi 1-1). Nhưng schema không có bảng lưu từng buổi 1-1 (chỉ có lịch tuần `PrivateCourseSchedule`), nên FR-47 chỉ điểm danh lớp nhóm và chưa trừ buổi 1-1. Cần quyết định ở FR-35/FR-36.
- **Migration `20261012170000_training_module`:** chuyển `WorkoutPlanItem.weekNumber`/`sessionNumber` sang NOT NULL. Migration sẽ lỗi trên database dùng chung nếu bảng này đang có dòng mang giá trị NULL. Render chạy `prisma migrate deploy` mỗi lần deploy (`render.yaml`), nên cần kiểm tra bảng này trước khi merge.
- **Middleware xác thực:** `src/middleware/auth.ts` là bản tạm cho FR-04. Khi hoàn thiện RBAC, chỉ cần giữ nguyên tên export `authenticate`, `authorize`, `getAuthUser`.
- **Role trong seed:** seed gốc tạo thêm role `CASHIER` và `ADMIN`, trong khi backlog chỉ có 4 role.

**system-design.md lệch với backlog (module này làm theo backlog):**
- Endpoint điểm danh: design ghi `POST /api/sessions/:id/attendance`, backlog ghi `PUT /api/class-sessions/:id/attendance`.
- Mã FR ở mục 7 của system-design đánh số khác hoàn toàn backlog (ví dụ FR-47 bên design là báo cáo đăng ký).
- Giáo án: design cho Coach tạo kế hoạch cho lớp hoặc cá nhân; backlog là giáo án dùng chung theo môn, chỉ gán cho khóa 1-1.
- Đánh giá tiến độ: design xếp "Giai đoạn sau", backlog FR-52 là Must.
- Design có nhưng backlog không có, nên chưa làm: check-in trung tâm, ghi kết quả buổi tập, bài tập về nhà, lưu nháp điểm danh, Member đánh dấu hoàn thành kế hoạch.
- Design ghi Session có Coach riêng; schema không có, nên Coach được lấy qua lớp.
- Design yêu cầu response có `requestId`; repo chưa có, module giữ đúng quy ước hiện tại của repo.

**Khác biệt giữa prompt giao việc và backlog, đã được chủ module chốt:**
- FR-51: chọn "chỉ chặn gán trùng cùng giáo án" (theo backlog), thay cho "mỗi khóa tối đa một giáo án ACTIVE".
- FR-49/50: chọn "mọi Coach được sửa giáo án dùng chung" (theo backlog), thay cho "chỉ người tạo hoặc Manager".
