function lockKey(branchCode, shelfCode) {
    const bc = parseInt(branchCode.replace(/\D/g, "")) || 0;
    const sc = parseInt(shelfCode.replace(/\D/g, "")) || 0;
    return bc * 10000 + sc;
}

module.exports = {
    lockKey,

    acquireLock: async (prisma, key) => {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(${key})::text`);
    },

    releaseLock: async (prisma, key) => {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${key})::text`);
    }
};
