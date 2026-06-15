const serialize = (data) => {
  if (data === null || data === undefined) return data;
  
  return JSON.parse(
    JSON.stringify(data, (_, value) =>
      typeof value === "bigint" ? Number(value) : value
    )
  );
};

module.exports = {
  serialize
};
