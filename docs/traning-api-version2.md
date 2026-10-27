# Sportigo API Version 2 — FR-12 đến FR-36

Tài liệu này tổng hợp API và nghiệp vụ backend thuộc phạm vi FR-12–FR-36: quản lý môn thể thao, phòng, lịch Coach, lớp nhóm, lịch buổi học, booking/waitlist, khóa học cá nhân, thanh toán và attendance. Mã nguồn chính nằm trong `src/modules/`.

Base URL local mặc định: `http://localhost:3000/api`. Tài liệu API đang chạy có tại `http://localhost:3000/api-docs`.

> Đây là hướng dẫn dựa trên routes, services và tests hiện có trong repository, không thay thế `G01_Backlog`/`G01_Rules`. Workbook backlog không có trong workspace hiện tại nên cần đối chiếu các quy tắc chi tiết với bản chính thức trước khi xác nhận hoàn tất. BR-06 không thuộc phạm vi FR-12–FR-36.

## 1. Chạy local

1. Sao chép `.env.example` thành `.env`, cấu hình `DATABASE_URL`, JWT secrets và các biến cần thiết.
2. Nếu chạy integration test, cấu hình `TEST_DATABASE_URL` tới PostgreSQL test riêng. Tên database cần chứa `test`; integration test có thể reset dữ liệu database này.
3. Cài dependencies và tạo schema:

   ```powershell
   npm ci
   npx prisma migrate deploy
   npm run db:seed
   npm run dev
   ```

4. Kiểm tra server tại `http://localhost:3000/health`; Swagger UI tại `http://localhost:3000/api-docs`.

Không dùng database production hoặc database có dữ liệu cần giữ làm `TEST_DATABASE_URL`.

### Cấu hình nghiệp vụ liên quan

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `CLASS_CANCELLATION_CUTOFF_HOURS` | `48` | Số giờ tối thiểu Member phải hủy trước buổi học đầu tiên. Giá trị mặc định giữ hành vi cũ; cần xác nhận với G01 trước khi phát hành. |
| `TEST_DATABASE_URL` | Không cấu hình | Database riêng cho integration test. Nếu bỏ trống, các test cần database có thể bị bỏ qua. |

## 2. Quy ước API

- Các endpoint cần đăng nhập nhận `Authorization: Bearer <accessToken>`. Lấy token từ `POST /api/auth/login`.
- Vai trò thường dùng trong phạm vi này: `MEMBER`, `COACH`, `RECEPTIONIST`, `CENTER_MANAGER`.
- Endpoint chỉ cho phép role phù hợp; các thao tác theo Member lấy danh tính từ token, không tin `memberId` do client tự gửi.
- Response hiện không đồng nhất giữa tất cả module: một số endpoint trả `{ success, data }`, một số trả dữ liệu trực tiếp. Hãy dùng response thực tế của endpoint hoặc Swagger làm chuẩn.
- Thời điểm và ngày nên gửi ở định dạng ISO 8601; ngày recurrence dùng quy ước của endpoint tương ứng.
- Những lỗi nghiệp vụ thường dùng `400` cho input sai, `401` khi chưa xác thực, `403` khi sai role/quyền sở hữu, `404` khi không tồn tại và `409` khi xung đột nghiệp vụ. Một số controller cũ có thể trả khác; cần kiểm tra response thực tế của từng API.

## 3. API theo nhóm nghiệp vụ

Tiền tố chung `/api`.

### FR-12–FR-16 — Tài nguyên thể thao và lớp nhóm

| Method & path | Role | Mô tả |
|---|---|---|
| `GET /sports` | Mọi role đã đăng nhập | Danh sách môn thể thao |
| `POST /sports` | CENTER_MANAGER | Tạo môn thể thao |
| `PUT /sports/:id` | CENTER_MANAGER | Cập nhật môn |
| `DELETE /sports/:id` | CENTER_MANAGER | Xóa môn; không xóa nếu đang được tham chiếu |
| `GET /rooms` | Mọi role đã đăng nhập | Danh sách phòng |
| `POST /rooms` | CENTER_MANAGER | Tạo phòng |
| `PUT /rooms/:id` | CENTER_MANAGER | Cập nhật phòng |
| `DELETE /rooms/:id` | CENTER_MANAGER | Xóa phòng theo điều kiện nghiệp vụ |
| `GET /coaches/:id/availability` | Mọi role đã đăng nhập | Xem lịch khả dụng của Coach |
| `POST /coaches/:id/availability` | CENTER_MANAGER | Thêm khung giờ khả dụng |
| `PUT /coaches/:id/availability/:availabilityId` | CENTER_MANAGER | Sửa khung giờ khả dụng |
| `DELETE /coaches/:id/availability/:availabilityId` | CENTER_MANAGER | Ngừng khung giờ khả dụng |
| `GET /coaches/:id/sports` | Mọi role đã đăng nhập | Xem môn Coach có chuyên môn |
| `POST /coaches/:id/sports` | CENTER_MANAGER | Gán chuyên môn cho Coach |
| `DELETE /coaches/:id/sports/:sportId` | CENTER_MANAGER | Gỡ chuyên môn Coach |
| `GET /coaches/:id/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` | CENTER_MANAGER; Coach chỉ xem lịch của mình | Lịch tổng hợp lớp nhóm và khóa 1–1; tối đa 90 ngày |
| `GET /group-classes` | CENTER_MANAGER | Danh sách lớp quản trị |
| `POST /group-classes` | CENTER_MANAGER | Tạo lớp nhóm |
| `PATCH /group-classes/:id` | CENTER_MANAGER | Sửa đầy đủ thông tin lớp |
| `PATCH /group-classes/:id/status` | CENTER_MANAGER | Đổi trạng thái lớp |
| `PATCH /group-classes/:id/coach` | CENTER_MANAGER | Phân công Coach |

Các kiểm tra chính gồm dữ liệu hợp lệ, môn/Coach đang hoạt động, Coach đủ điều kiện với môn, thời gian khả dụng hợp lệ và không trùng lịch. Lớp mới được tạo ở trạng thái phù hợp với quy trình mở đăng ký.

### FR-17–FR-20 — Session và recurrence

| Method & path | Role | Mô tả |
|---|---|---|
| `GET /group-classes/:id/sessions` | Mọi role đã đăng nhập | Xem các buổi học của lớp |
| `POST /group-classes/:id/sessions` | CENTER_MANAGER | Tạo một buổi học |
| `POST /group-classes/:id/sessions/recurring` | CENTER_MANAGER | Sinh các buổi học thực tế từ lịch lặp hàng tuần |
| `POST /class-sessions` | CENTER_MANAGER | Tạo session theo payload có `classId` |
| `POST /class-sessions/:id/change` | CENTER_MANAGER | Đổi lịch buổi học, bắt buộc có lý do |
| `POST /class-sessions/:id/cancel` | CENTER_MANAGER | Hủy riêng một buổi học, bắt buộc có lý do |

Lịch lặp được khai triển thành các bản ghi `ClassSession` riêng, không tạo bảng template recurrence. Mỗi lần diễn ra được kiểm tra xung đột Coach, Member, phòng và giới hạn ngày. Nếu có occurrence không hợp lệ, transaction không lưu dở dang các occurrence còn lại.

FR-20 kiểm tra trùng lịch Coach, phòng và Member, gồm cả lịch recurring khóa cá nhân; lưu lịch sử đổi, audit và thông báo Coach/Member trong cùng transaction. Hủy riêng một buổi chỉ áp dụng với session tương lai chưa có attendance, đồng thời ghi audit và thông báo người liên quan.

### FR-21–FR-29 — Booking, hủy và waitlist

| Method & path | Role | Mô tả |
|---|---|---|
| `GET /bookings/classes` | Public | Tìm lớp công khai, hỗ trợ lọc và phân trang |
| `GET /bookings/classes/:id` | Public | Chi tiết lớp, lịch, học phí và số chỗ |
| `POST /bookings/classes/:id/register` | MEMBER | Đăng ký lớp bằng tài khoản hiện tại |
| `POST /group-classes/:id/register-on-behalf` | RECEPTIONIST | Đăng ký hộ Member đã tồn tại |
| `POST /bookings/registrations/:id/cancel` | MEMBER, RECEPTIONIST | Hủy đăng ký theo quyền và chính sách |
| `POST /group-classes/:id/cancel` | CENTER_MANAGER | Hủy lớp, xử lý đăng ký và hoàn tiền |
| `POST /group-classes/:id/waitlist` | MEMBER | Tham gia danh sách chờ |
| `POST /group-classes/:id/waitlist/respond` | MEMBER | Chấp nhận hoặc từ chối offer qua `{ "accept": true/false }` |

Booking kiểm tra lớp đang mở, thời gian đăng ký, sức chứa, đăng ký trùng và lịch của Member. Đăng ký tạo order và giữ chỗ ở trạng thái chờ thanh toán. Hủy lớp của trung tâm hoàn tiền cho đăng ký đã xác nhận, hủy đăng ký đang chờ thanh toán và đóng các entry waitlist liên quan.

Việc kiểm tra số chỗ và cập nhật offer được bảo vệ bằng transaction cùng khóa theo lớp. Offer có hạn dùng; worker trên server xử lý offer hết hạn mỗi 60 giây, và các request liên quan cũng có thể xử lý trạng thái hết hạn. Không chạy nhiều worker độc lập ngoài cơ chế được triển khai nếu chưa kiểm tra cấu hình triển khai.

### FR-30–FR-35 — Khóa học cá nhân và thanh toán

| Method & path | Role | Mô tả |
|---|---|---|
| `GET /private-courses` | MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER | Danh sách khóa học đang hoạt động |
| `GET /private-courses/:id` | MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER | Chi tiết khóa học và Coach đủ điều kiện |
| `POST /private-courses` | CENTER_MANAGER | Tạo khóa học |
| `PATCH /private-courses/:id` | CENTER_MANAGER | Cập nhật khóa học/trạng thái |
| `POST /private-courses/:id/coaches` | CENTER_MANAGER | Phân công Coach |
| `DELETE /private-courses/:id/coaches/:coachId` | CENTER_MANAGER | Ngừng phân công Coach |
| `POST /private-courses/:id/enroll` | MEMBER | Đăng ký khóa học theo ID trên URL |
| `POST /private-courses/enrollments` | MEMBER | Tạo enrollment; Member lấy từ token |
| `GET /private-courses/enrollments` | MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER | Danh sách enrollment, lọc theo quyền truy cập |
| `GET /private-courses/enrollments/:id` | MEMBER, COACH, RECEPTIONIST, CENTER_MANAGER | Chi tiết enrollment theo quyền sở hữu/phân công |
| `POST /private-courses/enrollments/:id/schedules` | MEMBER chủ enrollment | Thêm lịch sau khi enrollment đủ điều kiện |
| `PATCH /private-courses/enrollments/:id/schedules/:scheduleId/occurrences/:sessionDate` | MEMBER chủ enrollment | Hủy hoặc đổi riêng một buổi học; yêu cầu trước ít nhất 24 giờ |
| `POST /orders/:id/pay` | MEMBER là chủ order | Thanh toán order bằng ví |
| `POST /orders/:id/payments/vnpay` | MEMBER | Khởi tạo thanh toán VNPay |
| `GET /payments/vnpay/return` | Public/provider callback | Return URL của VNPay |
| `GET /payments/vnpay/ipn` | Public/provider callback | IPN callback của VNPay |
| `POST /orders/:id/payments/cash` | RECEPTIONIST | Ghi nhận thanh toán tiền mặt |
| `POST /orders/:id/wallet-payments` | MEMBER | Thanh toán qua ví theo finance flow |

Enrollment yêu cầu khóa học `ACTIVE`, Coach đang hoạt động và assignment còn hiệu lực. Member chọn lịch cùng lúc tạo enrollment; enrollment ban đầu là `PENDING_PAYMENT`. Thanh toán thành công sẽ kích hoạt enrollment qua payment finalizer chung. Callback lặp được bảo vệ để không ghi nhận thanh toán/kích hoạt nhiều lần.

Các đường dẫn thanh toán ở trên thuộc các router finance và payment hiện được mount trong repository. Trước khi tích hợp client, hãy kiểm tra OpenAPI và controller để chọn đúng wallet endpoint đang được dùng.

### FR-36 / BR-30 — Attendance khóa cá nhân

| Method & path | Role | Mô tả |
|---|---|---|
| `POST /private-courses/enrollments/:id/schedules/:scheduleId/attendance` | COACH được phân công | Ghi nhận buổi học đã hoàn thành qua `sessionDate` |

Ghi nhận hoàn thành buổi khóa cá nhân phải thuộc Coach được phân công và enrollment hợp lệ. Cập nhật buổi đã ghi nhận và `remainingSessions` diễn ra nguyên tử; khóa ngoại/unique bảo vệ việc ghi lặp theo lịch và ngày.

Hiện private-course attendance lưu các buổi hoàn thành, chưa có trạng thái vắng/hủy riêng. Cần xác nhận G01 có yêu cầu trạng thái này trước khi mở rộng schema.

### FR-63–FR-64 — Thay đổi một buổi khóa 1–1 và lịch Coach tổng hợp

FR-63 lưu exception theo lịch recurring và ngày gốc; không thay đổi cả template lịch. Chỉ Member sở hữu enrollment được hủy/đổi. Thời hạn 24 giờ tính từ giờ bắt đầu ban đầu; đúng mốc 24 giờ vẫn được phép. Buổi đã hoàn thành hoặc đã có exception không thể thay đổi lần nữa. Khi đổi lịch, hệ thống giữ thời lượng gốc, kiểm tra trạng thái phòng, availability Coach và xung đột Coach/Member/phòng; attendance ngày gốc ghi nhận giờ đã đổi.

FR-64 `GET /api/coaches/:id/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD` tổng hợp session lớp nhóm và từng occurrence khóa 1–1, áp dụng exception hủy/đổi và giới hạn khoảng truy vấn tối đa 90 ngày. Coach chỉ xem lịch của chính mình; Center Manager có thể xem lịch Coach được chọn.

## 4. Luồng thử nhanh

### Đăng ký lớp nhóm

1. Đăng nhập bằng Member qua `POST /api/auth/login`.
2. Gọi `GET /api/bookings/classes` để chọn lớp đang mở và `GET /api/bookings/classes/:id` để xem chi tiết.
3. Gọi `POST /api/bookings/classes/:id/register` bằng access token Member.
4. Dùng `orderId` nhận được để thanh toán qua một phương thức được cấu hình (ví dụ `POST /api/orders/:id/pay`).
5. Gửi lại request đăng ký để xác nhận hệ thống từ chối đăng ký đang hoạt động bị trùng.

### Lịch lặp lớp nhóm

Center Manager gọi `POST /api/group-classes/:id/sessions/recurring`:

```json
{
  "roomId": 1,
  "recurrence": {
    "dayOfWeek": 2,
    "startTime": "18:00",
    "endTime": "19:00",
    "effectiveFrom": "2026-11-03",
    "effectiveTo": "2026-12-29"
  },
  "note": "Lịch lớp tối thứ Ba"
}
```

Các thuộc tính recurrence và định dạng thời gian phải theo schema/API hiện hành; nếu khác với ví dụ, xem Swagger hoặc validation trong service. Một conflict ở bất kỳ tuần nào phải làm request thất bại mà không tạo một phần lịch.

### Waitlist

Member gọi `POST /api/group-classes/:id/waitlist` khi lớp đầy. Khi nhận offer, phản hồi:

```json
{ "accept": true }
```

Gửi `{ "accept": false }` để từ chối. Offer hết hạn được worker xử lý và chuyển tiếp theo FIFO khi đủ điều kiện.

### Enrollment khóa cá nhân

Member tạo enrollment với `coachId`, `privateCourseId`, `startDate` và `schedules`; không gửi `memberId` để xác định chủ sở hữu. Kiểm tra trạng thái `PENDING_PAYMENT`, thanh toán order, sau đó đọc enrollment để xác nhận trạng thái được kích hoạt.

### FR-63: đổi một occurrence khóa cá nhân

Member gọi `PATCH /api/private-courses/enrollments/:id/schedules/:scheduleId/occurrences/:sessionDate` với một trong các body:

```json
{ "action": "CANCELLED", "reason": "Bận công việc" }
```

```json
{
  "action": "RESCHEDULED",
  "newStartsAt": "2026-11-10T10:00:00.000Z",
  "newRoomId": 2,
  "reason": "Đã thống nhất với Coach"
}
```

Đây là thay đổi riêng một ngày, không sửa các tuần còn lại. Coach được thông báo và thay đổi được ghi audit.

## 5. Kiểm thử

Chạy toàn bộ suite:

```powershell
npm test
```

Chạy một nhóm test:

```powershell
npx vitest run tests\bookings
npx vitest run tests\class-sessions
npx vitest run tests\private-courses
npx vitest run tests\finance
```

Kiểm tra type và lint:

```powershell
npm run typecheck
npm run lint
```

Test unit dùng Prisma mock không cần PostgreSQL. Integration test cần `TEST_DATABASE_URL` trỏ tới database test riêng; `tests/global-setup.ts` áp dụng migration vào database đó. Không cấu hình biến này tới production hoặc database chứa dữ liệu cần giữ.

Ma trận kiểm thử hiện có được ghi trong `tests/FR12-FR36-TEST-README.md`. Checklist `it.todo` trong `tests/fr12-fr36-implementation-gaps.test.ts` là việc chưa hoàn tất/xác minh, không phải assertion đã pass. Những khoảng trống được ghi nhận gồm API role/response coverage toàn diện cho FR12–FR16, một số luồng end-to-end và lifecycle, coverage mọi route quản trị, concurrency enrollment, và quyết định attendance vắng/hủy cho FR36.

## 6. FR → module → test

| FR | Nhóm API/module | Test tiêu biểu |
|---|---|---|
| FR-12 | `sports` | `tests/sports/sport.service.test.ts` |
| FR-13 | `rooms` | `tests/rooms/room.service.test.ts` |
| FR-14 | `coaches` | `tests/coaches/coach.service.test.ts` |
| FR-15–FR-16 | `group-classes` | `tests/group-classes/group-class.service.test.ts` |
| FR-17–FR-19 | `class-sessions` | `tests/class-sessions/session.service.test.ts`; `tests/bookings/fr12-fr36-api-auth.integration.test.ts` |
| FR-20 | `class-sessions` | `tests/class-sessions/session.service.test.ts` |
| FR-21–FR-24, FR-28 | `bookings` | `tests/bookings/booking.service.test.ts`; `tests/bookings/cancellation-policy.test.ts` |
| FR-25–FR-26 | `waitlist` | `tests/waitlist/waitlist.service.test.ts`; `tests/bookings/fr12-fr36-api-auth.integration.test.ts` |
| FR-29 / BR-16 | `private-courses` | `tests/private-courses/private-course.schedule.integration.test.ts` |
| FR-30–FR-35 | `private-courses`, `finance` | `tests/private-courses/private-course.service.test.ts`; `tests/finance/finance.integration.test.ts` |
| FR-36 / BR-30 | `private-courses`, `attendance` | `tests/private-courses/private-course.attendance.integration.test.ts` |
| FR-63 | `private-courses` | `tests/private-courses/private-course.service.test.ts` |
| FR-64 | `coaches` | `tests/coaches/coach.service.test.ts` |

## 7. Quyết định và giới hạn cần xác nhận

- Xác nhận chính sách hủy 48 giờ mặc định với G01 trước khi release; cấu hình tập trung qua `CLASS_CANCELLATION_CUTOFF_HOURS`.
- Xác nhận FR-36/BR-30 có cần lưu riêng trạng thái vắng hoặc hủy buổi khóa cá nhân hay không.
- G01 workbook không có trong workspace hiện tại; cần dùng tài liệu nguồn để rà soát chính xác từng BR, ngưỡng thời gian và status code.
- FR-20 đổi/hủy một buổi nhóm và FR-63 exception của một buổi 1–1 đã có implementation; cần xác nhận policy, notification recipients và cancellation/refund với G01 trước release.
- Không đưa BR-06 vào danh sách gap FR12–FR36 theo xác nhận phạm vi trước đó.
- Test pass chứng minh các assertion hiện có chạy thành công, không tự động chứng minh toàn bộ backlog đã được xác minh.
