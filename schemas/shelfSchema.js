const { z } = require("zod");

const createShelfItemSchema = z.object({
  body: z.object({
    items: z.array(z.object({
      branch_code: z.string().min(1, "Branch Code is required"),
      shelf_code: z.string().min(1, "Shelf Code is required"),
      item_code: z.string().min(1, "Item Code is required"),
      shelf_row_number: z.number().int().positive("Row No must be a positive integer"),
      shelf_index_number: z.number().int().min(0, "Index must be a non-negative integer"),
    })).min(1, "At least one item must be provided"),
  }),
});

const deleteShelfItemSchema = z.object({
  body: z.object({
    id: z.union([z.number().int(), z.string()]).optional(),
    branch_code: z.string().optional(),
    shelf_code: z.string().optional(),
    shelf_row_number: z.union([z.number().int(), z.string()]).optional(),
    item_code: z.string().optional(),
    shelf_index_number: z.union([z.number().int(), z.string()]).optional(),
  }).refine(data => data.id || (data.branch_code && data.shelf_code && data.shelf_row_number != null && data.item_code != null && data.shelf_index_number != null), {
    message: "Missing delete identifiers. Either 'id' or all of ('branch_code', 'shelf_code', 'shelf_row_number', 'item_code', 'shelf_index_number') must be provided.",
    path: ["id"],
  }),
});

const updateShelfItemSchema = z.object({
  body: z.array(z.object({
    branch_code: z.string().min(1, "Branch Code is required"),
    shelf_code: z.string().min(1, "Shelf Code is required"),
    item_code: z.string().min(1, "Item Code is required"),
    shelf_row_number: z.number().int().positive("Row No must be a positive integer"),
    shelf_index_number: z.number().int().min(0, "Index must be a non-negative integer"),
  })).min(1, "At least one item must be provided"),
});

const getSkuSchema = z.object({
  query: z.object({
    branch_code: z.string().min(1, "Branch Code is required"),
  }),
});

module.exports = {
  createShelfItemSchema,
  deleteShelfItemSchema,
  updateShelfItemSchema,
  getSkuSchema
};
