const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const { parseArgsStringToArgv } = require('string-argv');
const app = express();

let listen_port = 3000;
let m_queues = {"default":{}};
let m_queue_concurrency = {"default":1}

//UNHANDLED EXCEPTION
process.on('uncaughtException', function(err) {
  console.trace('Global uncaughtException error: ' , err);
  if (err.stack){
    err.stackTraceLimit = Infinity;
    console.error(err.stack);
  }	
});

process.on('unhandledRejection', (reason, promise) => {
  console.trace('Global unhandledRejection error: ' , reason);
  if (reason.stack) {
    console.error(reason.stack);
  }
})


//ROUTES
app.use('/', function(req, res, next) {
  var contype = req.headers['content-type'];
  //support user did not provide content-type
  req.headers['content-type'] = "application/json";
  next();
});

app.use(express.json());

// start the server
app.listen(listen_port, () => {
  console.log('Server is running on port ' + listen_port);
});

processQueues(); //keeps process running forever

// HTTP METHODS

app.get('/', (req, res) => {
  // let jobg_id = req.query.jobg_id;
  // let queue_id = 

  var found_job = false;
  Object.keys(m_queues).forEach(qid => {
    var queue = m_queues[qid];
    Object.keys(queue).forEach(jid => {
        if (jid == req.query.job_id)
          found_job = queue[jid];
    })
  })
  if (!found_job){
    return res.status(400).send({
      message: 'job_id [' + req.query.job_id + "] was not found "
   });
  }
  else{
    //remove spawn from job (too lengthy)
    const clone = (({ spawn, ...o }) => o)(found_job);
    res.json(clone);
  }
})

// POST endpoint for executing shell commands
app.post('/execute', (req, res) => {
  //req json contains command, queue_id and concurrent param
  //if there are already concurrent jobs running in queue_id, command is deferred.
  const command = req.body.command;

  console.log("new request:" ,req.body);
  // execute shell command
    
    var id = new Date().toISOString();
    var queue_item = {
      id:id,
      discover:req.protocol + "://" + req.hostname + ":" + listen_port + "/?job_id=" + id,
      start: false,
      end: false,
      create: new Date().toISOString(),
      exit_code:false,
      is_running: false,
      command: command,
      spawn:false,
      stdout:[],
      stderr:[],
    };
    
    //add job to queue
    if ("queue_id" in req.body){
      if (! (req.body.queue_id in m_queues)){
		console.log("Creating new queue :" + req.body.queue_id)
        m_queues[req.body.queue_id] = {}
        m_queue_concurrency[req.body.queue_id] = 5;
      }
      m_queues[req.body.queue_id][id] = queue_item;
    }
    else{
      m_queues["default"][id] = queue_item;
    }

    //update queue concurrency of queue if needed
    if("concurrency" in req.body){
      try{
        m_queue_concurrency[req.body.queue_id] = parseInt(req.body.concurrency);
		console.error("Reset queue concurrency of q:" +req.body.queue_id + " to:" +req.body.concurrency)
      }catch(ex){
		  console.error("concurrency could not be parsed from param 'concurrency'",ex)
	  }
    }
    res.json(queue_item);
});


// FUNCTIONS

async function processQueues(){

  const max_job_age_ms = 60 * 60 * 24 * 1000; //1 day

  while (true){
    await sleep(1000);
    try{
      //foreach queue
      Object.keys(m_queues).forEach(qid => {
          let queue = m_queues[qid];
          //foreach job in queue
          Object.keys(queue).forEach(jid => {
              let job = queue[jid];
              //start job if needed
			  if (job.end)
				return
			  
			  //TODO: print pending info periodically? console.log("job pending, currently running: ",get_running_count(queue),"concurrency setting:",m_queue_concurrency[qid])
              if (!job.start && get_running_count(queue) < m_queue_concurrency[qid]){
                  try{
					console.log("starting job",job.command)
                    start_job(job);
                  }catch(ex){
                    job.exit_code = -1;
                    job.end = new Date().toISOString();
                    job.is_running = false;
                    job.stderr = ex.stack;
                  }
              }
              //deletes old jobs
              if (job.end){
                if (new Date() - Date.parse(job.end) >  max_job_age_ms){
                  delete queue[jid];
                }
              }
          });
          //todo: delete empty queues
      });
    }catch(ex){
      console.error("fatal unexpected",ex)
    }
  }
}

function start_job(job){
    //spawns a process and updates job spawn
    
    let parsed_args = parseArgsStringToArgv(job.command);
    let processname = parsed_args.shift(); //first argument must be a process name to spawn, could be cmd on windows or ffmpeg or any other process
    let spawned = spawn(processname, parsed_args);
    job.start = new Date().toISOString();
    job.spawn = spawned;

    spawned.stdout.on('data', (data) => {
      job.stdout.push(data.toString());
      //console.log(`stdout: ${data}`);
    });

    spawned.stderr.on('data', (data) => {
      job.stderr.push(data.toString());
      //console.error(`stderr: ${data}`);
    });

    spawned.on('close', (code) => {
	  console.log("job process close",job.command)
      job.exit_code = code;
      job.end = new Date().toISOString();
      delete job.spawned;
      job.is_running = false;
    });

    spawned.on('error', (err) => {
      console.log("job process error",job.command)
      job.exit_code = -1;
      job.stderr.push(err.message)
      job.end = new Date().toISOString();
      job.is_running = false;
    })

}

//HELPERS
function sleep (time) {return new Promise(res => setTimeout(res, time, "done sleeping"))};

function get_running_count(queue){
  var cnt = 0;
  Object.keys(queue).forEach(jid => {
    if (queue[jid].start && !queue[jid].end)
      cnt ++
  })
  return cnt;
}