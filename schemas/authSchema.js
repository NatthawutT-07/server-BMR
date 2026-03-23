const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(3, "Name must be at least 3 characters").max(50),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(["admin", "user"]).optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    password: z.string().min(1, "Password is required"),
  }),
});

const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
};
