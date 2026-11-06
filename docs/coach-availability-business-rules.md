# Coach availability — business rules

- Availability là thời gian Coach có thể nhận lớp; không tự tạo lớp hay buổi học.
- Mỗi ca dài 90 phút và phải thuộc một trong bảy khung giờ cố định từ 07:00 đến 21:00.
- Mỗi lịch tháng phải có ít nhất 20 ca lặp mỗi tuần, trên ít nhất 5 ngày; mỗi ngày được chọn phải có 2–4 ca.
- Lịch tháng sau gửi lần đầu đến hết ngày 25; lịch bị từ chối được sửa và gửi lại đến hết ngày 28 (`Asia/Ho_Chi_Minh`).
- Bản sao tháng trước chỉ là `DRAFT`; chỉ `APPROVED` mới tạo `CoachAvailability` có hiệu lực.
- Ca đã phân công bị khóa, được tính vào tổng ca và chỉ thay bằng Change Request.
- Manager duyệt/từ chối toàn bộ submission; từ chối bắt buộc có lý do và Manager không sửa ô lịch.
- Khi duyệt đổi ca, buổi trong vòng 7 ngày giữ nguyên. Buổi xa hơn được chuyển trong cùng transaction nếu Coach, Member và phòng cũ đều không xung đột; Member chỉ nhận thông báo.
