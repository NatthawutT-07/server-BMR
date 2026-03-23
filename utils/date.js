exports.toDateRange = (start, end) => {
  return {
    start: new Date(start + "T00:00:00"),
    end: new Date(end + "T23:59:59")
  };
};
