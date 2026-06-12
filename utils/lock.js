function lockKey(branch_code, shelfCode) {
    const bc = parseInt(branch_code.replace(/\D/g, "")) || 0;
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

// protected by lock 2 admin ready