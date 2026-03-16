const { z } = require("zod");

const createShelfItemSchema = z.object({
  body: z.object({
    items: z.array(z.object({
      branchCode: z.string().min(1, "Branch Code is required"),
      shelfCode: z.string().min(1, "Shelf Code is required"),
      codeProduct: z.number().int().positive("Code Product must be a positive integer"),
      rowNo: z.number().int().positive("Row No must be a positive integer"),
      index: z.number().int().min(0, "Index must be a non-negative integer"),
    })).min(1, "At least one item must be provided"),
  }),
});

const deleteShelfItemSchema = z.object({
  body: z.object({
    id: z.union([z.number().int(), z.string()]).optional(),
    branchCode: z.string().optional(),
    shelfCode: z.string().optional(),
    rowNo: z.union([z.number().int(), z.string()]).optional(),
    codeProduct: z.union([z.number().int(), z.string()]).optional(),
    index: z.union([z.number().int(), z.string()]).optional(),
  }).refine(data => data.id || (data.branchCode && data.shelfCode && data.rowNo != null && data.codeProduct != null && data.index != null), {
    message: "Missing delete identifiers. Either 'id' or all of ('branchCode', 'shelfCode', 'rowNo', 'codeProduct', 'index') must be provided.",
    path: ["id"],
  }),
});

const updateShelfItemSchema = z.object({
  body: z.array(z.object({
    branchCode: z.string().min(1, "Branch Code is required"),
    shelfCode: z.string().min(1, "Shelf Code is required"),
    codeProduct: z.number().int().positive("Code Product must be a positive integer"),
    rowNo: z.number().int().positive("Row No must be a positive integer"),
    index: z.number().int().min(0, "Index must be a non-negative integer"),
  })).min(1, "At least one item must be provided"),
});

const getSkuSchema = z.object({
  body: z.object({
    branchCode: z.string().min(1, "Branch Code is required"),
  }),
});

module.exports = {
  createShelfItemSchema,
  deleteShelfItemSchema,
  updateShelfItemSchema,
  getSkuSchema
};
