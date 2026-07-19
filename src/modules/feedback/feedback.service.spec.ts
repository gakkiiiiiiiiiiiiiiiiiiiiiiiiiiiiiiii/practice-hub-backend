import {
  Feedback,
  FeedbackStatus,
  FeedbackType,
} from "../../database/entities/feedback.entity";
import { FeedbackService } from "./feedback.service";

describe("FeedbackService", () => {
  it("returns normalized image URLs in feedback details", async () => {
    const feedback = {
      id: 8,
      user_id: 1,
      type: FeedbackType.BUG,
      status: FeedbackStatus.PENDING,
      images: [
        "cloud://prod-env.current-bucket/feedback/example.jpg",
        "https://example.com/already-public.png",
      ],
    } as Feedback;
    const repository = {
      findOne: jest.fn().mockResolvedValue(feedback),
    };
    const uploadService = {
      getPublicImageUrl: jest.fn((url: string) =>
        url.startsWith("cloud://")
          ? "https://current-bucket.tcb.qcloud.la/feedback/example.jpg"
          : url,
      ),
    };
    const service = new FeedbackService(
      repository as any,
      uploadService as any,
    );

    const result = await service.getFeedbackDetail(8);

    expect(result.images).toEqual([
      "https://current-bucket.tcb.qcloud.la/feedback/example.jpg",
      "https://example.com/already-public.png",
    ]);
  });
});
