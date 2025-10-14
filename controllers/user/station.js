
const prisma = require("../../config/prisma");


exports.liststation = async (req, res) => {
    try {
        const stations = await prisma.station.findMany({
            orderBy: { id: 'asc' },
        });
        res.json(stations).status(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};

exports.callStation = async (req, res) => {
    try {
        const callStation = await prisma.itemminmax.findMany()
        res.json(callStation).status(200)
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'callstation error' })
    }
}



// stationId: true,
// stationWord: true,
// stationEN: true,
// stationTH: true

// // Get one post
// app.get('/posts/:id', async (req, res) => {
//   const id = Number(req.params.id);
//   try {
//     const post = await prisma.post.findUnique({ where: { id } });
//     if (!post) return res.status(404).json({ error: 'Not found' });
//     res.json(post);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

// // Create post
// app.post('/posts', async (req, res) => {
//   const { title, content } = req.body;
//   try {
//     const created = await prisma.post.create({ data: { title, content }});
//     res.status(201).json(created);
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ error: 'Bad request' });
//   }
// });

// // Update post
// app.put('/posts/:id', async (req, res) => {
//   const id = Number(req.params.id);
//   const { title, content, published } = req.body;
//   try {
//     const updated = await prisma.post.update({
//       where: { id },
//       data: { title, content, published }
//     });
//     res.json(updated);
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ error: 'Bad request' });
//   }
// });

// // Delete post
// app.delete('/posts/:id', async (req, res) => {
//   const id = Number(req.params.id);
//   try {
//     await prisma.post.delete({ where: { id } });
//     res.status(204).send();
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ error: 'Bad request' });
//   }
// });