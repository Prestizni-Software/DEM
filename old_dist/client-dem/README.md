# client-dem

Report any issues, words of apritiation or anger here: https://github.com/Prestizni-Software/DEM
There you can also find in test_* some examples

Since v0.3 the all mighty DeusExMachina has all functions so far needed. That includes:

## Auto Status function
Thanks to a definition, you are now able to set rules for automatically updated property of your objects (mostly status of given object). With this will DEM automatically check if the current states meets your criteria and if it does, it wil handle the rest on its own! IT'S ALIVE!!!

## Auto Population
With "@populateRef("ClassName:Property.Path") you can set a 'virtual' property, that is gonna be populated when this object will get refered at the specified path.

## Auto Types checking
Still just shallow, but the server DEM will sent it's type definitions to the client and if they don't metch, it will for security reasons not start.

## Access Handeling
You are able to restrict any acces to any events and you can also hide some info at the startup!