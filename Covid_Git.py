#!/usr/local/bin/python3
#Packages
import json
import datetime
from geopy.distance import distance
import time
import datetime
import pytz 
import requests
import os
from twilio.rest import Client

#Function

#changes None type to blank
def xstr(s):
    if s is None:
        return ''
    else:
        return str(s)

#Variables

phone = '+1' + <''># Send to Phone Number
home = <latitude>, <longtitude> # You can find lat long from google maps by typing in address and right clicking pin that gets dropped
tz = pytz.timezone("US/Eastern") # Time Zone you can set to Central Eastern etc
radius=20 # Radius you want from your lat long location
totloops=96 # How many total loops you want to run in program
sleeptime=1800 # Time to sleep between loops 
state=<'XX'> #State Code you want to look at ie GA needs to be uppercase
zipcode=<'00000'>#Used just incase text string is to long to send full message 1600 Chars
twilosid=<'xxxxx'>
twiloauthkey=<'xxxx'>
twiloassignedphone=<'xxxx'>

loop=0

while(loop<=totloops):

	# Get Reques to grab data from vaccinespotter
	url='https://www.vaccinespotter.org/api/v0/states/'+ state + '.json' 
	response = requests.request("GET", url)

	json_dictionary = json.loads(json.dumps(response.json()))

	#Getting total number of elems in json response
	elms=len(json_dictionary['features'])

	#starting message
	tmessage='******Covid-19 Vaccine Avaliabilty Update******\n'

	#Looping through all elements and getting neccessary variables for message and creating messeage
	for i in range(elms):
		if (json_dictionary['features'][i]['properties']['appointments_available']==True): #If avaliable appoitment for loaction continue
			loc=json_dictionary['features'][i]['geometry']['coordinates'][1],json_dictionary['features'][i]['geometry']['coordinates'][0]
			d=round(distance(loc,home).miles,2) 
			if(d<radius): #Only looking at 
				apptcnt=len(json_dictionary['features'][i]['properties']['appointments'])
				tmessage+='There are '+ str(apptcnt) + ' appoinments avaliable at ' + xstr(json_dictionary['features'][i]['properties']['provider_brand_name']) + ' in ' + xstr(json_dictionary['features'][i]['properties']['city']) +', which is ' +str(d) + ' miles away\n'
				tmessage+='Address: ' + xstr(json_dictionary['features'][i]['properties']['address']) + ', ' + xstr(json_dictionary['features'][i]['properties']['city']) + ', ' + xstr(json_dictionary['features'][i]['properties']['state']) + ' ' + xstr(json_dictionary['features'][i]['properties']['postal_code']) + '\n'
				vactype=json_dictionary['features'][i]['properties']['appointment_vaccine_types']
				vactype=[*vactype]
				vactype=', '.join(vactype)
				tmessage+='Vaccine types that are avaliable are: ' + vactype + '\n'

				#creating appttime array so we can select min max appt times
				appttimearray=[]
				for ia in range(apptcnt):
					appttimearray.append(json_dictionary['features'][i]['properties']['appointments'][ia]['time'])
				if(len(appttimearray)==0):
					tmessage+='Could Not parse Appointment Times\n'
				else:
					tmessage+='Earliest appointment time is ' + min(appttimearray)[0:10] + ' @ ' + min(appttimearray)[11:16] + '\n'
					tmessage+='Latest appointment time is ' + max(appttimearray)[0:10] + ' @ ' + max(appttimearray)[11:16] + '\n'
				tmessage+='To schedule an appointment vist: ' + xstr(json_dictionary['features'][i]['properties']['url']) + '\n'
				utctime=datetime.datetime.strptime(json_dictionary['features'][i]['properties']['appointments_last_fetched'], "%Y-%m-%dT%H:%M:%S.%f+00:00")
				esttime=tz.fromutc(utctime)
				
				tmessage+= 'Last update time was ' + xstr(esttime.strftime("%Y-%m-%d @ %H:%M:%S")) + '\n'
				tmessage+= '\n--------------------------------\n\n'
				
	tmessage+= 'To Stop Receiving Updates please respond with STOP'
	
	if(len(tmessage) > 100):
		if(len(tmessage)>1599): #1600 is max char length for twilo so just sending generic message if threshold is met
			tmessage='******Covid-19 Vaccine Avaliabilty Update******\nThere are a lot of vaccines avaliable near by vist: https://www.vaccinespotter.org/' + state + '/?zip=' + zipcode + '\nTo Stop Receiving Updates please respond with STOP'
		
		#printing to console
		print('Sending Message....')
		print(tmessage)

		#Twilo API to send text 

		account_sid = twilosid
		auth_token = twiloauthkey
		client = Client(account_sid, auth_token)
		message = client.messages.create(
		                              body=tmessage,
		                              from_=twiloassignedphone,
		                              to=phone
		                          )

		print(message.sid)
	else:
		print('No Vaccines around')
	loop+1
	time.sleep(sleeptime) #Sleeping
