/**
 * Standard Response Helpers for BrightMind Retail
 */

/**
 * Send a success response
 * @param {Object} res - Express response object
 * @param {Any} data - The data to send
 * @param {Object} meta - Optional metadata (pagination, ranges, etc.)
 * @param {String} message - Optional success message
 * @param {Number} status - HTTP status code (default 200)
 */
exports.success = (res, data, meta = null, message = "Success", status = 200) => {
  return res.status(status).json({
    success: true,
    ok: true, // Legacy support
    message,
    data,
    meta
  });
};

/**
 * Send an error response
 * @param {Object} res - Express response object
 * @param {String} message - Human-readable error message
 * @param {String} error - Short error code (e.g., 'VALIDATION_ERROR')
 * @param {Number} status - HTTP status code (default 500)
 * @param {Object} details - Optional error details
 */
exports.error = (res, message = "Internal Server Error", error = "INTERNAL_ERROR", status = 500, details = null) => {
  return res.status(status).json({
    success: false,
    message,
    error,
    details
  });
};
