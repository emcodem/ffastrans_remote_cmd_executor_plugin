var fs = require("fs");
const axios = require("axios");

//prepare logging 
var log_file = fs.createWriteStream(__dirname + '/debug.log', {flags : 'w'});
log_file.write("Arguments: " + JSON.stringify(process.argv) + "\n") 

//read input job ticket
let rawdata = fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/, ""); //get rid of UTF8 BOM
log_file.write("JOBTICKET");

let o_job = JSON.parse(rawdata);
console.log(o_job["proc_data"]);

 
//GET OUTPUTS - make them available as global objects
var output_stdout = filterById(o_job["proc_data"]["outputs"],"stdout");
var output_stderr = filterById(o_job["proc_data"]["outputs"],"stderr");


//GET INPUTS // the fields in this object was defined by the index.html which belongs to this processor
var hostnames = filterById(o_job["proc_data"]["inputs"], "hostnames")["value"];
hostnames = comma_to_array(hostnames);
var queue_name = filterById(o_job["proc_data"]["inputs"], "queue_name")["value"];
var max_concurrent = filterById(o_job["proc_data"]["inputs"], "concurrency")["value"];
var fireandforget = filterById(o_job["proc_data"]["inputs"], "fireandforget")["value"];
var cmd = filterById(o_job["proc_data"]["inputs"], "cmd")["value"];

console.log("Inputs: ", hostnames,queue_name,max_concurrent,fireandforget,cmd);

main(); //DO THE WORK

let max_retries = 20;

async function main(){
	var job;
	var do_poll = !fireandforget;
    var do_retry = true;
    var got_error = false;
    var request_count = 0;
	//call the webservice until conditions are met
	var response = {};
	try{	
		response = await start_job();
		job = response.data;
	}catch(e){
		console.log("Error calling web service" , e);
		console.log("Start job error",e);
		process.exit(1)
	}
	
	var retry_count = 0;
	
    while(do_poll){
       await sleep(1000);
	   try{
		   response = await get_job_status(job.id)
		   if (response.status != 200)
				throw new Error("Status code " + response.status);
		   if (response.data.end){
				do_poll = false;
				console.log("Job end detected.")
		   }
		
	   }catch(ex){
			if (retry_count > max_retries)
				do_poll = false;
			else
				console.error("Got error  in get job status, retrying. Code: ",ex)
	   }
    }//retry while
		
        
	//end processor
	//decide final exit code

	var statuscode = 0;
    var responseBody = response["data"];
    statuscode = response["status"];
   
	console.log("Final respons",responseBody)
	console.log("Final response code: " , statuscode);
	console.log("stdouterr",responseBody.stdout,responseBody.stderr)
	output_stdout["data"] = responseBody.stdout.join("\n");
	output_stderr["data"] = responseBody.stderr.join("\n");

	write_output();	
	if (responseBody.exit_code != 0){
		process.exit(responseBody.exit_code);
	}
	
	if (! (statuscode > 199 && statuscode < 300)){
		console.log("Status codes other than 2xx are threated as error");
		process.exit(statuscode);
	}
	
}

//HELPERS 

function bodyToString(what){
//since we disabled all parsers, we always get a buffer object
    return what.toString();	
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}   

async function start_job(){

	var res = await axios.post("http://" + hostnames[0] + ":3000/execute"
			,{
				command: cmd,
				concurrency: max_concurrent || 5,
				queue_id : queue_name || "default"
			});

	//var res = await client["postPromise"]("/execute", args); //method name is like getPromise,postPromise etc
	console.log("Start Job Status code:",res.status);
	console.log("Response data",res["data"]);
	return res;

}

async function get_job_status(job_id){
	console.log("Calling url " + "http://" + hostnames[0] + ":3000/?job_id=" +job_id)
	var res = await axios.get("http://" + hostnames[0] + ":3000/?job_id=" +job_id);
	console.log("get_job_status code:",res.status);
	console.log("Response data",res["data"]);
	return res;

}


function write_output(){
	console.log("Writing ffastrans output file",o_job["processor_output_filepath"])
	fs.writeFileSync(o_job["processor_output_filepath"],JSON.stringify(o_job,null,3),"utf8");
}

//
//HELPERS
//

function comma_to_array(what){
    what = what.split(",");
    return what;
    
}

function filterByTerm(array, string){
//fuzzy term matching
    var out = [];
    for (idx in array){
        console.log(array[idx].id);
        if (array[idx].id.indexOf(string) != -1){
            out.push(array[idx]);
        }
    }
    return out;
    
}

function filterById(array, string) {
//finds by key in input variable array
    for (idx in array){
        if (array[idx].id == string){
            return array[idx];
        }
    }
}
