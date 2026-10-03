require('dotenv').config();
const path=require('path');
const fs=require('fs');
const express=require('express');
const rateLimit=require('express-rate-limit');
const sqlite3=require('sqlite3').verbose();
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const nodemailer=require('nodemailer');

const app=express();
const PORT=Number(process.env.PORT||3000);
const ROOT=__dirname;
const DATA=path.join(ROOT,'data');
fs.mkdirSync(DATA,{recursive:true});
const db=new sqlite3.Database(path.join(DATA,'glamhouse.sqlite'));
const JWT_SECRET=process.env.JWT_SECRET||'dev-only-change-me';
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||'admin';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'admin123';

app.use(express.json({limit:'50kb'}));
app.use(express.urlencoded({extended:false}));
app.use(rateLimit({windowMs:15*60*1000,max:100,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(ROOT,'public')));

function run(sql,params=[]){return new Promise((resolve,reject)=>db.run(sql,params,function(err){if(err)reject(err);else resolve({id:this.lastID,changes:this.changes});}));}
function all(sql,params=[]){return new Promise((resolve,reject)=>db.all(sql,params,(e,r)=>e?reject(e):resolve(r)));}
function get(sql,params=[]){return new Promise((resolve,reject)=>db.get(sql,params,(e,r)=>e?reject(e):resolve(r)));}
function now(){return new Date().toISOString();}

(async()=>{
 await run(`CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL,
  event_date TEXT, event_time TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 )`);
 await run(`CREATE TABLE IF NOT EXISTS admin_users(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL)`);
 const existing=await get('SELECT username FROM admin_users WHERE username=?',[ADMIN_USERNAME]);
 if(!existing){await run('INSERT INTO admin_users(username,password_hash) VALUES(?,?)',[ADMIN_USERNAME,bcrypt.hashSync(ADMIN_PASSWORD,12)]);}
})().catch(console.error);

function clean(v,max=1000){return String(v??'').trim().slice(0,max)}
function validPhone(v){return /^[0-9+()\-\s]{8,20}$/.test(v)}
function auth(req,res,next){
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 try{req.admin=jwt.verify(token,JWT_SECRET);next();}catch{res.status(401).json({error:'Unauthorized'});}
}

const sseClients=new Set();
function broadcast(event,data){const payload=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of sseClients){try{res.write(payload)}catch{}}}

async function notifySalon(booking){
 const lines=[`New AH Glam House appointment #${booking.id}`,`Name: ${booking.name}`,`Phone: ${booking.phone}`,`Service: ${booking.service}`,`Event date: ${booking.event_date||'Not specified'}`,`Event time: ${booking.event_time||'Not specified'}`,`Details: ${booking.message||'None'}`];
 const body=lines.join('\n');
 const results={email:false,whatsapp:false};
 if(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SALON_EMAIL){
  try{
   const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE)==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
   await transporter.sendMail({from:process.env.SMTP_USER,to:process.env.SALON_EMAIL,subject:`New booking #${booking.id} — ${booking.name}`,text:body});results.email=true;
  }catch(e){console.error('Email notification failed:',e.message)}
 }
 if(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.SALON_WHATSAPP_TO){
  try{
   const twilio=require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
   await twilio.messages.create({from:process.env.TWILIO_WHATSAPP_FROM,to:process.env.SALON_WHATSAPP_TO,body});results.whatsapp=true;
  }catch(e){console.error('WhatsApp notification failed:',e.message)}
 }
 return results;
}

app.get('/api/health',(req,res)=>res.json({ok:true,time:now()}));

app.post('/api/bookings',async(req,res)=>{
 try{
  const name=clean(req.body.name,80), phone=clean(req.body.phone,30), service=clean(req.body.service,80), event_date=clean(req.body.event_date,20), event_time=clean(req.body.event_time,20), message=clean(req.body.message,1500);
  if(!name||!phone||!service) return res.status(400).json({error:'Name, phone and service are required.'});
  if(!validPhone(phone)) return res.status(400).json({error:'Please enter a valid phone number.'});
  const allowed=['Bridal Makeup','Engagement Makeup','Reception Makeup','Party Makeup','Saree Draping with Makeup','HD Makeup'];
  if(!allowed.includes(service)) return res.status(400).json({error:'Invalid service.'});
  const created_at=now();
  const r=await run(`INSERT INTO bookings(name,phone,service,event_date,event_time,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,[name,phone,service,event_date||null,event_time||null,message||null,'pending',created_at,created_at]);
  const booking=await get('SELECT * FROM bookings WHERE id=?',[r.id]);
  const notifications=await notifySalon(booking);
  broadcast('booking',booking);
  res.status(201).json({ok:true,bookingId:r.id,booking,notifications});
 }catch(e){console.error(e);res.status(500).json({error:'Could not create booking.'});}
});

app.post('/api/admin/login',async(req,res)=>{
 const username=clean(req.body.username,100),password=String(req.body.password||'');
 const u=await get('SELECT * FROM admin_users WHERE username=?',[username]);
 if(!u||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:'Invalid username or password'});
 const token=jwt.sign({username:u.username},JWT_SECRET,{expiresIn:'12h'});
 res.json({token,username:u.username});
});

app.get('/api/admin/bookings',auth,async(req,res)=>{
 const status=req.query.status?clean(req.query.status,20):null;
 const rows=await all(`SELECT * FROM bookings ${status?'WHERE status=?':''} ORDER BY datetime(created_at) DESC`,status?[status]:[]);
 res.json(rows);
});

app.patch('/api/admin/bookings/:id',auth,async(req,res)=>{
 const id=Number(req.params.id);const status=clean(req.body.status,20);
 if(!['pending','confirmed','completed','cancelled'].includes(status))return res.status(400).json({error:'Invalid status'});
 const r=await run('UPDATE bookings SET status=?,updated_at=? WHERE id=?',[status,now(),id]);
 if(!r.changes)return res.status(404).json({error:'Booking not found'});
 const booking=await get('SELECT * FROM bookings WHERE id=?',[id]);broadcast('booking_update',booking);res.json(booking);
});

app.delete('/api/admin/bookings/:id',auth,async(req,res)=>{
 const r=await run('DELETE FROM bookings WHERE id=?',[Number(req.params.id)]);if(!r.changes)return res.status(404).json({error:'Booking not found'});res.json({ok:true});
});

app.get('/api/admin/events',(req,res)=>{
 const token=String(req.query.token||''); try{req.admin=jwt.verify(token,JWT_SECRET)}catch{return res.status(401).end()}
 res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();res.write(`event: connected\ndata: ${JSON.stringify({ok:true})}\n\n`);sseClients.add(res);req.on('close',()=>sseClients.delete(res));});

app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'public','admin','index.html')));
app.get('*',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Not found'});res.sendFile(path.join(ROOT,'public','index.html'));});

app.listen(PORT,'0.0.0.0',()=>console.log(`AH Glam House running on port ${PORT}`));
