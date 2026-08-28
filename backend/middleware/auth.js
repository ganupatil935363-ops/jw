
const jwt = require('jsonwebtoken');
function authenticate(req,res,next){
  if(!process.env.JWT_SECRET) return res.status(500).json({message:'JWT_SECRET is not configured on the server'});
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token) return res.status(401).json({message:'Authentication required. Please login.'});
  try { req.user=jwt.verify(token,process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({message:'Invalid or expired authentication token. Please login again.'}); }
}
function requireAdmin(req,res,next){ authenticate(req,res,()=>req.user?.isAdmin?next():res.status(403).json({message:'Admin authorization required.'})); }
module.exports={authenticate,requireAdmin};
