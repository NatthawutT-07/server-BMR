const { z } = require("zod");

const createShelfItemSchema = z.object({
  body: z.object({
    items: z.array(z.object({
      branch_code: z.string().min(1, "Branch Code is required"),
      shelfCode: z.string().min(1, "Shelf Code is required"),
      item_code: z.string().min(1, "Item Code is required"),
      rowNo: z.number().int().positive("Row No must be a positive integer"),
      index: z.number().int().min(0, "Index must be a non-negative integer"),
    })).min(1, "At least one item must be provided"),
  }),
});

const deleteShelfItemSchema = z.object({
  body: z.object({
    id: z.union([z.number().int(), z.string()]).optional(),
    branch_code: z.string().optional(),
    shelfCode: z.string().optional(),
    rowNo: z.union([z.number().int(), z.string()]).optional(),
    item_code: z.string().optional(),
    index: z.union([z.number().int(), z.string()]).optional(),
  }).refine(data => data.id || (data.branch_code && data.shelfCode && data.rowNo != null && data.item_code != null && data.index != null), {
    message: "Missing delete identifiers. Either 'id' or all of ('branch_code', 'shelfCode', 'rowNo', 'item_code', 'index') must be provided.",
    path: ["id"],
  }),
});

const updateShelfItemSchema = z.object({
  body: z.array(z.object({
    branch_code: z.string().min(1, "Branch Code is required"),
    shelfCode: z.string().min(1, "Shelf Code is required"),
    item_code: z.string().min(1, "Item Code is required"),
    rowNo: z.number().int().positive("Row No must be a positive integer"),
    index: z.number().int().min(0, "Index must be a non-negative integer"),
  })).min(1, "At least one item must be provided"),
});

const getSkuSchema = z.object({
  body: z.object({
    branch_code: z.string().min(1, "Branch Code is required"),
  }),
});

module.exports = {
  createShelfItemSchema,
  deleteShelfItemSchema,
  updateShelfItemSchema,
  getSkuSchema
};
