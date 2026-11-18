# Hiệu suất và bảng lương

- Kỳ lương là tháng dương lịch theo `Asia/Ho_Chi_Minh`. Chỉ lập bảng lương sau khi tháng kết thúc.
- Center Manager cấu hình lương cơ bản và khoản phụ cấp/khấu trừ định kỳ theo tháng hiệu lực, sau đó tạo bảng lương nháp, đối soát và duyệt.
- Trừ vắng = lương cơ bản × số ca/buổi vắng ÷ số ca/buổi được xếp trong tháng, làm tròn đến đồng. Không được xếp ca/buổi thì không trừ lương cơ bản.
- Lễ tân thiếu giờ vào hoặc giờ ra của ca đã kết thúc được tính là vắng. Yêu cầu chỉnh chấm công đang chờ duyệt chặn duyệt kỳ lương.
- Buổi nhóm chưa hoàn tất điểm danh và buổi 1–1 chưa được hội viên xác nhận chặn duyệt kỳ lương.
- Buổi bù hoàn thành và đã xác nhận được cộng lại khoản trừ vắng. `PayrollMakeupCredit` có khóa duy nhất theo yêu cầu báo nghỉ để tránh cộng hai lần, kể cả bù ở tháng sau.
- Bảng lương `APPROVED` là bản chốt. Không được tính lại hoặc sửa phiếu; điều chỉnh cấu hình về sau không thay đổi kỳ đã duyệt.
- Coach/lễ tân chỉ xem hiệu suất và phiếu lương đã duyệt của chính mình. Hệ thống không tự tính thuế/bảo hiểm và không chuyển tiền.

API chính: `GET /api/staff/performance`, `GET /api/payroll/me/performance`, `GET /api/payroll/me/payslips`, `GET /api/payroll/periods/:month`, `POST /api/payroll/periods/:month/build`, `POST /api/payroll/periods/:month/approve`, `GET /api/payroll/periods/:month/export`. Xem Swagger để biết các API cấu hình lương và tải PDF.
