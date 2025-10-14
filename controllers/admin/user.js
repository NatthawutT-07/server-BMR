const prisma = require("../../config/prisma");

exports.listUser = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        enabled: true,
        address: true,
      },
    });
    res.json(users);
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "List Users Error" });
  }
};

exports.changeStatus = async (req, res) => {
  try {
    //เปลี่ยนสถานะผู้ใช้งาน
    const { id, enabled } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { enabled: enabled },
    });

    res.send("Update Status Success");
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "changeStatus Error" });
  }
};

exports.changeRole = async (req, res) => {
  try {
    const { id, role } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { role: role },
    });

    res.send("Update Role Success");
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "changeStatus Error" });
  }
};

exports.userCart = async (req, res) => {
  try {
    const { cart } = req.body;
    const user = await prisma.user.findFirst({
      where: { id: Number(req.user.id) },
    });

    //check quantity สินค้นเพียงที่หรือไม่ ?
    for (const item of cart) {
      // console.log(item)
      const product = await prisma.product.findUnique({
        where: { id: item.id }, // หาสินค้าอย่างเดียวกัน
        select: { quantity: true, title: true },
      });
      // console.log(product)
      if (!product || item.count > product.quantity) {
        return res.status(400).json({
          ok: false,
          msg: `ขออภัย สินค้า ${product?.title || "product"} หมด`,
        });
      }
    }

    // Delete old Cart item
    await prisma.productOnCart.deleteMany({
      where: {
        cart: { orderedById: user.id },
      },
    });

    //Delete old Cart
    await prisma.cart.deleteMany({
      where: { orderedById: user.id },
    });

    //เตรียมสินค้า
    let products = cart.map((item) => ({
      productId: item.id,
      count: item.count,
      price: item.price,
    }));

    let cartTotal = products.reduce(
      (sum, item) => sum + item.price * item.count,
      0 //ค่าเริ่มต้น
    );

    const newCart = await prisma.cart.create({
      data: {
        products: {
          create: products,
        },
        cartTotal: cartTotal,
        orderedById: user.id,
      },
    });

    console.log(newCart);
    res.send("Add Cart Ok");
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "userCart Error" });
  }
};

exports.getUserCart = async (req, res) => {
  try {
    //req.user.id
    const user = await prisma.cart.findFirst({
      where: {
        orderedById: Number(req.user.id),
      },
      include: {
        products: {
          include: {
            product: true,
          },
        },
      },
    }); //ได้ตะกร้า = id

    res.json({
      user,
      // product : cart.product,
      // cartTotal : cartTotal
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "getUserCart Error" });
  }
};

exports.emptyCart = async (req, res) => {
  try {
    const cart = await prisma.cart.findFirst({
      where: { orderedById: Number(req.user.id) },
    }); // who id ?
    if (!cart) {
      return res.status(400).json({ msg: "No cart" });
    }
    // delete out
    await prisma.productOnCart.deleteMany({
      where: { cartId: cart.id },
    });
    const result = await prisma.cart.deleteMany({
      where: { orderedById: Number(req.user.id) },
    });

    console.log(result);
    res.json({ msg: "Cart Empty Success", deletedCount: result.count });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "emptyCart Error" });
  }
};

exports.saveAddress = async (req, res) => {
  try {
    const { address } = req.body;
    const addressUser = await prisma.user.update({
      where: {
        id: Number(req.user.id),
      },
      data: {
        address: address,
      },
    });
    res.json({ ok: true, msg: "Address update success" });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "saveAddress Error" });
  }
};

exports.saveOrder = async (req, res) => {
  try {
    // console.log(req.user);
    // return res.send("hello");

    const { id, amount, status, currency } = req.body.paymentIntent;

    // stap 1 get user cart
    const userCart = await prisma.cart.findFirst({
      where: {
        orderedById: Number(req.user.id),
      },
      include: { products: true },
    });

    // check cart empty
    if (!userCart || userCart.products.length === 0) {
      return res.status(400).json({ ok: false, msg: "Cart is Empty" });
    }

    const amountTHB = Number(amount) / 100;
    //create a new Order
    const order = await prisma.order.create({
      data: {
        products: {
          create: userCart.products.map((item) => ({
            productId: item.productId,
            count: item.count,
            price: item.price,
          })),
        },
        orderedBy: {
          // เชื่อม order ของใคร
          connect: { id: req.user.id },
        },
        cartTotal: userCart.cartTotal,
        stripePaymentId: id,
        amount: amountTHB,
        status: status,
        currentcy: currency,
      },
    });

    // update product
    const update = userCart.products.map((item) => ({
      where: { id: item.productId },
      data: {
        quantity: { decrement: item.count },
        sold: { increment: item.count },
      },
    }));
    //รอเท่านั้น
    await Promise.all(update.map((updated) => prisma.product.update(updated)));

    await prisma.cart.deleteMany({
      where: { orderedById: Number(req.user.id) },
    });

    res.json({ ok: true, order });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "saveOrder Error" });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await prisma.order.findMany({
      where: { orderedById: Number(req.user.id) },
      include: {
        products: {
          include: {
            product: true,
          },
        },
      },
    });

    if (order.length === 0) {
      return res.status(400).json({ ok: false, msg: "No orders" });
    }

    res.json({ ok: true, order });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "getOrder Error" });
  }
};
