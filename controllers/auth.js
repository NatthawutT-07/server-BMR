const prisma = require("../config/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  try {
    const { name, password } = req.body;
    //step 1 validate body
    if (!name) {
      return res.status(400).json({ message: "Name is require!!!" });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is require!!!" });
    }
    //step 2 chack email in DB already
    const user = await prisma.user.findFirst({
      where: {
        name: name,
      },
    });
    if (user) {
      return res.status(400).json({ msg: "name already exits!!" });
    }

    //step 3 hashPassword
    const hashPassword = await bcrypt.hash(password, 10);
    console.log(hashPassword);

    //step 4 register
    await prisma.user.create({
      data: {
        name: name,
        password: hashPassword,
      },
    });

    res.send("register success");
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "server error" });
  }
};


// exports.logoutuser = async (req, res) => {
//   try {
//     const userEmail = req.user.email;
//     await prisma.user.update({
//       where: { email: userEmail },
//       data: { enabled: false },
//     });

//     res.json({ message: "User logge out and disabled successfully" });
//   } catch (e) {
//     console.log(e);
//     res.status(500).json({ message: "server error during logout" });
//   }
// };

exports.login = async (req, res) => {
  try {
    const { name, password } = req.body;
    // step 1 check email
    const user = await prisma.user.findFirst({
      where: {
        name: name,
      },
    });
    if (!user || !user.enabled) {
      return res.status(400).json({ msg: "User Not found or not Enabled" });
    }

    // step 2 check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Password Invalid!!!" });
    }

    // step 3 create payload
    const payload = {
        id : user.id ,
        name :user.name,
        role : user.role
    }
    // step 4 Generate Token
    jwt.sign(payload,process.env.SECRET,{expiresIn:'1d'},(err,token)=>{
        if(err){
            return res.status(500).json({msg:"payload falid"})
        }
        res.json({payload , token})
    })
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "server error" });
  }
};

exports.currentUser = async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: {name: req.user.name,},
      
      select: {
        id: true,
        name: true,
        role: true
      }
    })
    
    res.json({user});
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "server error" });
  }
};

exports.currentAdmin = async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: { name: req.user.name },
      select: {
        id: true,
        name: true,
        role: true
      }
    });

    // if (user.role !== 'admin') {
    //   return res.status(401).json({ message: "You are not an admin" });
    // }

    res.json({ user });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "Server error" });
  }
};

