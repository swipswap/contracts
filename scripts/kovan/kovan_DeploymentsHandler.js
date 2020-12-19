const fs = require('fs')

const saveToFile = (content) => {
  let newContent
  fs.readFile('./deployments.json', 'utf8' , (_, data) => {
    if(!data){
      newContent = {[0]: {...content} }
    }
    if(data){
      let index = 0
      while(data[index]){
        index++
      }
      newContent = {...JSON.parse(data), [index]: {...content}}
    }
    newContent = JSON.stringify(newContent)
    fs.writeFileSync('./deployments.json', newContent, err => {
      if (err) {
        console.error(err)
        return
      }
         //done!
    })
  })
}

const nodeDetails = (version) => {
  return fs.readFile('./deployments.json', 'utf8', (e, data) => {
    if(e) return
    const deployments = JSON.parse(data)
    if(!version) {
      let index = 0
      while(deployments[index]){
        index++
      }
      // select the last one
      return deployments[index--]
    }
    // select the expected version
    return JSON.parse(data)[version]
  })
}

module.exports = { saveToFile, nodeDetails }