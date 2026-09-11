import { UserController } from "./user.controller";

describe("UserController profile update", () => {
  const user = { userId: 2 };
  const dto = { nickname: "测试昵称", avatar: "" };

  it.each([
    ["PUT", "updateProfile"],
    ["POST", "updateProfileByPost"],
  ])(
    "keeps the %s profile route behavior consistent",
    async (_method, handler) => {
      const updateProfile = jest.fn().mockResolvedValue({ id: 2, ...dto });
      const controller = new UserController(
        { updateProfile } as any,
        null as any,
        null as any,
      );

      await expect((controller as any)[handler](user, dto)).resolves.toEqual({
        code: 200,
        msg: "success",
        data: { id: 2, ...dto },
      });
      expect(updateProfile).toHaveBeenCalledWith(2, dto);
    },
  );
});
