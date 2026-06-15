exports.success = (res, data, meta = null, message = "Success", status = 200) => {
  return res.status(status).json({
    success: true,
    ok: true, // Legacy support
    message,
    data,
    meta
  });
};

exports.error = (res, message = "Internal Server Error", error = "INTERNAL_ERROR", status = 500, details = null) => {
  return res.status(status).json({
    success: false,
    message,
    error,
    details
  });
};
