// Unofficial HAMP Library for Javascript v3
// (C) 2012 Dr Paul Brewer 
// Licensed under version 2 of the GNU General Public License
//
// VARIABLE NAMING CONVENTIONS
//
// Hungarian notation prefixes for variable names:
// bo - borrower
// ol - original loan
// fm - Freddie Mac public data
// ml - modified loan
// po - policy
//
// expected elements in Q hash (case study or UI inputs)
// boMoGrossIncome -- borrowers monthly gross income
// boMoMiscHousingExpense -- borrowers (approved) misc housing expense
// olUnpaid -- original loan unpaid balance
// olHomeMarketValue -- home value in todays market
// olMoRemain -- original loan months remaining
// olRate -- original loan interest rate
// fmCap -- freddie mac cap rate (30 yr PMMS rate)
// poDoPR -- 1 for alternative (principal-reduction) waterfall
// poDoLenderVariation -- check if principal reduction exceeds 5%
//                   if so, lengthen loan then reduce rate
//
// A HAMP result hash contains these elements (outputs)
// all result elements are unformatted strings, should be rounded to nearest dollar for dollar values
// mlTargetAGIPct
// mlPR = Principal Reduction
// mlUnpaid = new Unpaid balance = olUnpaid - mlPR
// mlLTV = 100 * mlUnpaid/olHomeMarketValue 
// mlMoTotalTargetPayment = mlTargetAGIPCT % of bMoGrossIncome
// mlMoMiscHousingExpense = copied from bMoMiscHousingExpense
// mlMoTargetPayment = target for loan payment, == total-misc
// mlRate1to5 -- interest rate first 5 years
// mlMoPayment1to5 -- modified monthly loan payment first 5 years
// mlMonths -- term (length) of modified loan in months
// mlChangeMonths -- months for which rate changes occur -- as a string
// mlChangeRates -- new rates that take effect on the months above -- as a string
// mlChangePayments -- new payments that take effect on the months above -- as a string
// mlBalloon -- balloon payment at the end, if any.  if none, return a zero.
// mlBalloonMax -- servicers not required to exceed max(30% mlUnpaid, <100%LTV)
// mlTotalPayments -- total of all payments on loan for life of loan
// mlFail -- 1 if the modification fails some policy test
// mlFailReason -- string indicating why the modification failes

function noFrames() {
	if(top != self) {
		document.write('');
		alert("The web page you are visiting takes content from www.armdisarm.com and tries to display it as part of their own web page. Pressing OK will attempt to load www.armdisarm.com directly.  Thanks -- Dr Paul Brewer armdisarm.com ");
		top.location.replace(self.location.href);
	}
}

function numerize(x){ var xx=1*x; return (isNaN(xx)?x:xx)}

function roundStep(x, step) {
    // returns x rounded to the nearest step
    return step * Math.round(x / step);
}

function tagString(tag,opt){ 
    var s = "<";
    s = s + tag ;
    for (var k in opt){
	s = s + ' ' + k + '=' + '"' + opt[k] + '" ';
    }    
    s = s + '>';
    return s;
}

function ArrayPluckHTML(A, H, order, tableOptions){
    var s = tagString('table',tableOptions);
    return s.concat('<tr><th>', 
		    H.join('</th><th>'), 
		    '</th></tr>', 
		    (_(A).map(function(r){ return '<tr><td>'+(_(order).map(function(e){ return r[e]; })).join('</td><td>') + '</td></tr>' ; })).join(''),
		    '</table>'
		   );     
}

Tier1HAMP = function(qINPUTS){ 
    var ml = {};
    var mlRate = [];
    var mlPayment = [];
    var q = {};

    function mlMergeHAMPfuture() {	
	var rate = ml.mlRate1to5;
 	var N,i,m,MonthArray,RateArray,AmortLoan,PaymentChangeArray;
	mlRate = [];
	mlPayment = [];
	try {
	    if( (rate < q.fmCap) && (ml.mlMonths>60) ) {
		N = Math.floor(q.fmCap - rate);
		MonthArray = []; 
		for(i=0; i<=N; ++i){ MonthArray.push(60+12*i); }
		RateArray = [];
		for(i=1; i<=N; ++i){ RateArray.push(rate+i); }
		RateArray.push(q.fmCap);
		AmortLoan = ml.mlUnpaid - ml.mlBalloon;
		PaymentChangeArray = _(TVM.VariableRateLoanPaymentArray(AmortLoan, ml.mlMonths, rate, MonthArray, RateArray)).map(Math.round);
		ml.mlChangeMonths = MonthArray.join(' --  ');
		ml.mlChangeRates =  RateArray.join(' -- ');
		ml.mlChangePayments = PaymentChangeArray.join(' -- ');
		for(m=0;m<MonthArray[0];m++){ mlRate[m]=ml.mlRate1to5; mlPayment[m]=ml.mlMoPayment1to5; }
		ml.mlTotalPayments = ml.mlMonths*ml.mlMoPayment1to5;
		ml.mlTotalPayments += (PaymentChangeArray[0] - ml.mlMoPayment1to5) * (ml.mlMonths - MonthArray[0]);
		for(i=1;i<=N;++i){ 
		    if(ml.mlMonths > MonthArray[i]) { 
			ml.mlTotalPayments += (PaymentChangeArray[i]-PaymentChangeArray[i-1]) * (ml.mlMonths-MonthArray[i]); 
		    }
		}
		MonthArray.push(ml.mlMonths);
		for(i=1;i<=N+1;++i){
		    for(m=MonthArray[i-1]; m<Math.min(ml.mlMonths,MonthArray[i]); m++){ 
			mlRate[m]=RateArray[i-1]; 
			mlPayment[m]=PaymentChangeArray[i-1]; 
		    }
		}
	    } else {
		ml.mlTotalPayments = ml.mlMonths * ml.mlMoPayment1to5;
		for(m=0;m<ml.mlMonths;m++){ mlRate[m]=ml.mlRate1to5; mlPayment[m]=ml.mlMoPayment1to5; }
	    }
	} catch(e){ console.log(e); }
	ml.mlTotalPayments = Math.round(ml.mlTotalPayments+ml.mlBalloon);
    }

    function getPayment1to5(){
	return Math.round(TVM.StandardLoanPayment(ml.mlRate1to5,ml.mlUnpaid-ml.mlBalloon,ml.mlMonths));
    }

    function policyLengthBeforeRate(){
	// see MHA Handbook v3.3, p.81, sect 6.4.4 Variation from the Alternative Modification Waterfall 
	// lender is allowed to modify length before reducing rate if more than 5% of principal is forgiven
	return (q.poDoPR && q.poDoLenderVariation && ml.mlPR && (ml.mlPR > (0.05*q.olUnpaid)));
    }

    function doPrincipalReductionByStep(step,floorLTV){ 
	if (!ml.mlUnpaid){ ml.mlUnpaid = q.olUnpaid-ml.mlPR; }
	try {
	    if (ml.mlUnpaid > (floorLTV*q.olHomeMarketValue)){ 
		ml.mlPR += step;
		// MHA Handbook, v4.0 (6.6.1) says PR counts towards limit
		if (ml.mlBalloonMax > 0){ ml.mlBalloonMax += -1*step;} else { ml.mlBalloonMax = 0; }
		ml.mlUnpaid = q.olUnpaid-ml.mlPR;
		ml.mlLTV = Math.round(100*ml.mlUnpaid/q.olHomeMarketValue);
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Reducing Principal to $'+ml.mlUnpaid;
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }
    

    // see MhaHandbook v3.3, section 6.3.2 Step 2 -- Interest Rate Reduction
    // If the current rate is not at a 0.125 percentage point increment, servicers
    //    should _not_ round the interest rate first. 
    // Fix applied to Unofficial Calculator --  May 2012
    function doReduceRateByStep(step, floor){
	try {
	    if(ml.mlRate1to5 > floor) {
		ml.mlRate1to5 = ml.mlRate1to5 - step;
		if (ml.mlRate1to5 < floor){ ml.mlRate1to5 = floor }
		if (ml.mlRate1to5<=0){ ml.mlRate1to5=0.000001;}
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Reducing Rate to '+ml.mlRate1to5+'%';
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }	
    
    
    function doIncreaseLengthByStep(stepMonths, maxLength) {
	try {
	    if(ml.mlMonths < maxLength) {
		ml.mlMonths += stepMonths;
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Increasing time to pay to '+ml.mlMonths+' months';
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }


    function doIncreaseBalloonByStep(stepBalloon) {
	try {
	    if(ml.mlBalloon < ml.mlUnpaid) {
		ml.mlBalloon += stepBalloon;
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Creating balloon payment of $'+ml.mlBalloon;
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }

    function doCheck(){
	try {
	    if(ml.mlBalloon && ml.mlBalloonMax && (ml.mlBalloon > ml.mlBalloonMax)){
		ml.mlFail=1;
		ml.mlFailReason='Balloon exceeds maximum suggested';
		return false;
	    }
	    return true;
	} catch(e){ console.log(e); }
	return false;
    }
    
    function doStep(){
	try {
	    if (!loanIsAffordable()) {
		if (q.poDoPR){
		    if (doPrincipalReductionByStep(1000,1.15)){ return true; }
		}
		if (policyLengthBeforeRate()){
		    if (doIncreaseLengthByStep(1,480)){ return true; }
		    if (doReduceRateByStep(0.125, 2.0)){ return true; }
		} else {
		    if (doReduceRateByStep(0.125, 2.0)){ return true; }
		    if (doIncreaseLengthByStep(1,480)){ return true; }
		}
		if (doIncreaseBalloonByStep(1000)){ return true; }
	    }
	    ml.mlCalculatorStep = 'Finished calculations -- Final result';
	    doCheck();
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }
    
   function init(qINPUT){
       try {
	   q = _.clone(qINPUT);
	   if (!q.poTargetAGIPct){ q.poTargetAGIPct = 31; }
	   ml = null;
	   ml = {
	       'mlUnpaid': q.olUnpaid,
	       'mlPR': 0,
	       'mlLTV': Math.round(100*q.olUnpaid/q.olHomeMarketValue),
	       'mlTargetAGIPct': q.poTargetAGIPct,
	       'mlMoTotalTargetPayment': Math.round(q.poTargetAGIPct*q.boMoGrossIncome/100.0),
	       'mlMoMiscHousingExpense': q.boMoMiscHousingExpense,
	       'mlMoTargetPayment': '',
	       'mlRate1to5': q.olRate,
	       'mlMoPayment1to5': '',
	       'mlMonths': q.olMoRemain,
	       'mlChangeMonths': 'no changes',
	       'mlChangeRates': '',
	       'mlChangePayments': '',
	       'mlBalloon': 0.00,
	       'mlBalloonMax': Math.round(Math.max(0.30*q.olUnpaid, (q.olUnpaid-q.olHomeMarketValue))),
	       'mlFail': 0,
	       'mlFailReason':''
	   };		
	   ml.mlMoTargetPayment = Math.round(ml.mlMoTotalTargetPayment-ml.mlMoMiscHousingExpense);
	   ml.mlMoPayment1to5 = getPayment1to5();
	   ml.mlTotalPayments = ml.mlMonths * ml.mlMoPayment1to5;
	   if ( loanIsAffordable() ){ 
	       ml.mlCalculatorStep = "This loan already affordable: Final result -- no modification";
	       return false;
	   }
	   return true;
       } catch(e){ console.log(e); }
       return false;
    }

    function getML() { return _.clone(ml); }
    function getQ() { return _.clone(q); }

    function loanIsAffordable(){
	// supposed to stop before going under Target
	// add small fudge factor to stay close to, but above Target
	return (ml.mlMoPayment1to5 <= (ml.mlMoTargetPayment*1.01));
    }
    
    function finish(){ 
	while (doStep()){ }
	return ml;
    }


    function scheduleOfPayments(){
	try {
	    var schedule = [];
	    var firstMonth = {'Month': 1,
			      'PreviousBalance': q.olUnpaid, 
			      'InterestBearing':ml.mlUnpaid-ml.mlBalloon,
			      'NonInterestBearing': (ml.mlPR+ml.mlBalloon),
			      'Payment': mlPayment[0],
			      'InterestRate': mlRate[0],
			      'InterestPaid': 0,
			      'PrincipalPaid': 0,
			      'PrincipalForgiveness': ml.mlPR,
			      'NewBalance':0
			     };
	    var row = {};
	    var m = 1;
	    firstMonth.InterestPaid = Math.round(firstMonth.InterestBearing*firstMonth.InterestRate/1200.0);
	    firstMonth.PrincipalPaid = firstMonth.Payment - firstMonth.InterestPaid;
	    firstMonth.NewBalance = firstMonth.PreviousBalance-firstMonth.PrincipalPaid-firstMonth.PrincipalForgiveness;
	    schedule.push(firstMonth);
	    while( m < ml.mlMonths ){
		row = {'Month':m+1,
		       'PreviousBalance': schedule[m-1].NewBalance,
		       'InterestBearing': schedule[m-1].InterestBearing-schedule[m-1].PrincipalPaid,
		       'NonInterestBearing': schedule[m-1].NonInterestBearing-schedule[m-1].PrincipalForgiveness,
		       'Payment': mlPayment[m],
		       'InterestRate': mlRate[m],
		       'InterestPaid': 0,
		       'PrincipalPaid': 0,
		       'PrincipalForgiveness': 0,
		       'NewBalance':0
		      };
		row.InterestPaid = Math.round(row.InterestBearing*row.InterestRate/1200.0);
		row.PrincipalPaid = row.Payment - row.InterestPaid;
		row.NewBalance = row.PreviousBalance - row.PrincipalPaid - row.PrincipalForgiveness;
		schedule.push(row);
		m++;
	    }
	    return schedule;
	} catch(e){ console.log(e); }
	return [];
    }

    function scheduleOfPaymentsHTML(){
	var headings = ['Month','Previous Balance','Interest Bearing','Non Interest Bearing','Payment','Interest Rate','Interest Payment','Principal Payment','Principal Forgiven','New Balance'];
	var order = ['Month','PreviousBalance','InterestBearing','NonInterestBearing','Payment','InterestRate','InterestPaid','PrincipalPaid','PrincipalForgiveness','NewBalance'];
	var preamble = '<html><head><title>Schedule Of Payments</title></head><body>';
	var post = '</body></html>';
	return ArrayPluckHTML(scheduleOfPayments(),headings,order,{'border':1, 'style': 'text-align: right;'});
    }

    // call init with qINPUTS and return an object pointing to functions we can call later

    init(qINPUTS);
    
    return {'getML': getML,
	    'getQ': getQ,
	    'loanIsAffordable': loanIsAffordable,
	    'doStep': doStep,
	    'finish': finish,
	    'scheduleOfPayments': scheduleOfPayments,
	    'scheduleOfPaymentsHTML': scheduleOfPaymentsHTML
	   };
	    
};

Tier2HAMP = function(qINPUTS){ 
    var ml = {};
    var mlRate = [];
    var mlPayment = [];
    var q = {};

    function mlMergeHAMPfuture() {
	try {
	    mlRate = [];
	    mlPayment = [];
	    ml.mlTotalPayments = ml.mlMonths * ml.mlMoPayment1to5;
	    for(m=0;m<ml.mlMonths;m++){ mlRate[m]=ml.mlRate1to5; mlPayment[m]=ml.mlMoPayment1to5; }
	    ml.mlTotalPayments = Math.round(ml.mlTotalPayments+ml.mlBalloon);
	} catch(e){ console.log(e); }
    }

    function getPayment1to5(){
	return Math.round(TVM.StandardLoanPayment(ml.mlRate1to5,ml.mlUnpaid-ml.mlBalloon,ml.mlMonths));
    }

    function doReduceRate(){
	try {
	    var hamp2Rate = (Math.ceil(8.0*q.fmCap)/8.0)+0.5;
	    // hamp 2 rate is defined in MHA Handook v4.0 section 6.3.2.2
	    // hamp 2 Rate = FM 30 YR rate, rounded up to the next 1/8%, plus risk prem of 0.5%
	    if(ml.mlRate1to5 != hamp2Rate) {
		ml.mlRate1to5 = hamp2Rate;
		if (ml.mlRate1to5<=0){ ml.mlRate1to5=0.000001;}
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Reducing Rate to '+ml.mlRate1to5+'%';
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }	
    
    
    function doIncreaseLength() {
	try {
	    if(ml.mlMonths < 480) {
		ml.mlMonths = 480;
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Increasing time to pay to '+ml.mlMonths+' months';
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }
    
    var canTryBalloon = 1;

    function doBalloon() {
	try {
	    if(canTryBalloon) {
		ml.mlBalloon = Math.round(Math.max(0,Math.min(0.30*q.olUnpaid, (q.olUnpaid-1.15*q.olHomeMarketValue))));
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Creating balloon payment of $'+ml.mlBalloon;
		canTryBalloon=0;
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }

    var canTryPR = 1;

    function doPrincipalReduction(){ 
	try {
	    if (!ml.mlUnpaid){ ml.mlUnpaid = q.olUnpaid-ml.mlPR; }
	    if (canTryPR){ 
		ml.mlPR = Math.round(Math.max(0,Math.min(0.30*q.olUnpaid, (q.olUnpaid-1.15*q.olHomeMarketValue))));
		ml.mlUnpaid = q.olUnpaid-ml.mlPR;
		ml.mlLTV = Math.round(100*ml.mlUnpaid/q.olHomeMarketValue);
		ml.mlMoPayment1to5 = getPayment1to5();
		mlMergeHAMPfuture();
		ml.mlCalculatorStep = 'Reducing Principal to $'+ml.mlUnpaid;
		canTryPR = 0;
		return true;
	    }
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }

    function doCheck(){ 
	try {
	    var totalMoPayment;	
	    if ((ml.mlMoPayment1to5+ml.mlMoMiscHousingExpense) > ml.mlMoTotalTargetPaymentHigh){ 
		ml.mlFail=1;
		ml.mlFailReason='Payments exceed target range';
		return false;
	    } 
	    if ((ml.mlMoPayment1to5+ml.mlMoMiscHousingExpense) < ml.mlMoTotalTargetPaymentLow){ 
		ml.mlFail=1;
		ml.mlFailReason='Payments below target range';
		return false;
	    }
	    return true;
	} catch(e){ console.log(e); }
	return false;
    }
    
    function doStep(){
	try {
	    if (doReduceRate()){ return true; }
	    if (doIncreaseLength()){ return true; }
	    if (q.poDoPR){
		if (doPrincipalReduction()){ return true; }
	    } else {
		if (doBalloon()){ return true; }
	    }
	    ml.mlCalculatorStep = 'Finished calculations -- Final result';
	    doCheck();
	    return false;
	} catch(e){ console.log(e); }
	return false;
    }
    
   function init(qINPUT){
       try {
	   q = _.clone(qINPUT);
	   if (!q.poH2TargetAGIPctLow){ q.poH2TargetAGIPctLow = 25; }
	   if (!q.poH2TargetAGIPctHigh){ q.poH2TargetAGIPctHigh = 42; }
	   ml = null;
	   ml = {
	       'mlUnpaid': q.olUnpaid,
	       'mlPR': 0,
	       'mlLTV': Math.round(100*q.olUnpaid/q.olHomeMarketValue),
	       'mlTargetAGIPct': q.poH2TargetAGIPctLow+'-'+q.poH2TargetAGIPctHigh,
	       'mlMoTotalTargetPaymentLow':  Math.round(q.poH2TargetAGIPctLow*q.boMoGrossIncome/100.0),
	       'mlMoTotalTargetPaymentHigh': Math.round(q.poH2TargetAGIPctHigh*q.boMoGrossIncome/100.0),
	       'mlMoMiscHousingExpense': q.boMoMiscHousingExpense,
	       'mlMoTargetPayment': '',
	       'mlRate1to5': q.olRate,
	       'mlMoPayment1to5': '',
	       'mlMonths': q.olMoRemain,
	       'mlChangeMonths': 'no changes',
	       'mlChangeRates': '',
	       'mlChangePayments': '',
	       'mlBalloon': 0.00,
	       'mlBalloonMax': 'H2 No Max',
	       'mlFail': 0,
	       'mlFailReason':''
	   };
	   ml.mlMoTotalTargetPayment = ml.mlMoTotalTargetPaymentLow+'-'+ml.mlMoTotalTargetPaymentHigh;
	   ml.mlMoTargetPayment = Math.round(ml.mlMoTotalTargetPaymentLow-ml.mlMoMiscHousingExpense) +'-'+Math.round(ml.mlMoTotalTargetPaymentHigh-ml.mlMoMiscHousingExpense);
	   ml.mlMoPayment1to5 = getPayment1to5();
	   ml.mlTotalPayments = ml.mlMonths * ml.mlMoPayment1to5;
	   return true;
       } catch(e){ console.log(e); }
       return false;
    }

    function getML() { return _.clone(ml); }
    function getQ() { return _.clone(q); }

    function loanIsAffordable(){
	// in Hamp2 all steps must be completed without regard to affordability
	// could deal with this in a abstraction layer
	return false;
    }
    
    function finish(){ 
	while (doStep()){ }
	return ml;
    }

    function scheduleOfPayments(){
	try {
	    var schedule = [];
	    var firstMonth = {'Month': 1,
			      'PreviousBalance': q.olUnpaid, 
			      'InterestBearing':ml.mlUnpaid-ml.mlBalloon,
			      'NonInterestBearing': (ml.mlPR+ml.mlBalloon),
			      'Payment': mlPayment[0],
			      'InterestRate': mlRate[0],
			      'InterestPaid': 0,
			      'PrincipalPaid': 0,
			      'PrincipalForgiveness': ml.mlPR,
			      'NewBalance':0
			     };
	    var row = {};
	    var m = 1;
	    firstMonth.InterestPaid = Math.round(firstMonth.InterestBearing*firstMonth.InterestRate/1200.0);
	    firstMonth.PrincipalPaid = firstMonth.Payment - firstMonth.InterestPaid;
	    firstMonth.NewBalance = firstMonth.PreviousBalance-firstMonth.PrincipalPaid-firstMonth.PrincipalForgiveness;
	    schedule.push(firstMonth);
	    while( m < ml.mlMonths ){
		row = {'Month':m+1,
		       'PreviousBalance': schedule[m-1].NewBalance,
		       'InterestBearing': schedule[m-1].InterestBearing-schedule[m-1].PrincipalPaid,
		       'NonInterestBearing': schedule[m-1].NonInterestBearing-schedule[m-1].PrincipalForgiveness,
		       'Payment': mlPayment[m],
		       'InterestRate': mlRate[m],
		       'InterestPaid': 0,
		       'PrincipalPaid': 0,
		       'PrincipalForgiveness': 0,
		       'NewBalance':0
		      };
		row.InterestPaid = Math.round(row.InterestBearing*row.InterestRate/1200.0);
		row.PrincipalPaid = row.Payment - row.InterestPaid;
		row.NewBalance = row.PreviousBalance - row.PrincipalPaid - row.PrincipalForgiveness;
		schedule.push(row);
		m++;
	    }
	    return schedule;
	} catch(e){ console.log(e); }
	return [];
    }

    function scheduleOfPaymentsHTML(){
	var headings = ['Month','Previous Balance','Interest Bearing','Non Interest Bearing','Payment','Interest Rate','Interest Payment','Principal Payment','Principal Forgiven','New Balance'];
	var order = ['Month','PreviousBalance','InterestBearing','NonInterestBearing','Payment','InterestRate','InterestPaid','PrincipalPaid','PrincipalForgiveness','NewBalance'];
	var preamble = '<html><head><title>Schedule Of Payments</title></head><body>';
	var post = '</body></html>';
	return ArrayPluckHTML(scheduleOfPayments(),headings,order,{'border':1, 'style': 'text-align: right;'});
    }

    // call init with qINPUTS and return an object pointing to functions we can call later

    init(qINPUTS);
    
    return {'getML': getML,
	    'getQ': getQ,
	    'loanIsAffordable': loanIsAffordable,
	    'doStep': doStep,
	    'finish': finish,
	    'scheduleOfPayments': scheduleOfPayments,
	    'scheduleOfPaymentsHTML': scheduleOfPaymentsHTML
	   };
	    
};


AnyTierHAMP = function(qINPUT){ 
    var Calculator;
    if (qINPUT.poHampTier==2){ 
	Calculator = Tier2HAMP(qINPUT);
    } else {
	Calculator = Tier1HAMP(qINPUT);
    }
    return Calculator;
};


function readInputs(){
    var q = {};
    var unknownItem = [];

    try {
	$(':input').each(function(i){
	    try { 
		if ((this.type === "text") || (this.type === "hidden")){ 
		    q[this.id]=numerize(this.value);
		} else if (this.type === "checkbox"){
		    q[this.id]=(this.checked)?1:0;
		} else {
		    unknownItem.push(this.id);
		}
	    } catch(e) { 
		console.log('readInputs() this.id='+this.id+' Exception:'+e); 
	    }
	});
	
	_(unknownItem).each(function(item){ 
	    try { 
		q[item] = $('#'+item+' :selected').val();
	    } catch(e) {
		if (item.length && item.length>0) { delete q[item]; }
	    }
	});
    } catch(e){ console.log(e); }

    return q;
};

UHC = function(){ 
    
    var animationRunning = 0;

// H will hold an instance of AnyTierHAMP to do the calculation
// but empty for now

    var H; 
    var q = {};
    
    function writeML(){
	var ml = H.getML();
	try {
	    $('span[id^="ml"]').html(function(index,oldhtml){ return ml[this.id] });  
	} catch(e){ console.log(e); }
	// "this" was set to each el by JQuery html(), see JQuery html() docs
	return ml;
    }
      
    function startAnimation(){
	q = readInputs();
	if (animationRunning === 0){ 
	    H = AnyTierHAMP(q);
	    writeML();
	    if ( !H.loanIsAffordable() ){ 
		newAnimation(); 
	    }
	}
	return true;
    }

    function newAnimation(){
	animationRunning=1;
	try {
	    $('#skipDiv').show();
	    $('#popupDiv').hide();
	} catch(e){ console.log(e); }
	loopAnimation();
	try { hampGraph.PopulateXLimits(); } catch(e) {}
	return true;
    }

    function loopAnimation(){ 
	if ( (animationRunning===0) || (!H.doStep())  ){ 
	    animationRunning=0;
	    try {
		$('#skipDiv').hide();
		$('#popupDiv').show();
	    } catch(e){ console.log(e); }
	} else {
	    try {
		_.delay(loopAnimation,1000*( (q.frameDelay)? q.frameDelay: 0.2 ) );
	    } catch(e){ console.log(e); }
	}
	writeML(); 	
    }

    function skipToEnd(){ 
	try {
	    if(animationRunning===1){ 
		$('#skipDiv').hide();
		animationRunning=0;
		H.finish();
		writeML();
	    }
	} catch(e){ console.log(e); }
    }

    function popupScheduleOfPayments(){
	var w;
	skipToEnd();
	try {
	    w=window.open("","","");
	    $(w.document.body).append(H.scheduleOfPaymentsHTML());
	} catch(e){ console.log(e); }
    }
    
    return {
	'startAnimation': startAnimation,
	'skipToEnd': skipToEnd,
	'popupScheduleOfPayments': popupScheduleOfPayments
    };
    
}();

hampGraph = { 
    'PopulateXLimits': function(){
	var q = readInputs();
	var center = q[q.gcX];
	try {
	    $('#gcFrom').val(Math.round(0.7*center));
	    $('#gcTo').val(Math.round(1.3*center));
	} catch(e){ console.log(e); }
    },
    'Calculate': function(qq){
	var q = _.clone(qq);
	var j=0;
	var points = 20;
	var data = [];
	var result;
	while(j <= points){
	    try { 
		q[q.gcX] = ( (j*q.gcTo) + ((points-j)*q.gcFrom) )/points;
		result = AnyTierHAMP(q).finish();
		if ( (result.mlFail===0) || q.gcIgnoreFail ){ data.push([q[q.gcX],result[q.gcY]]); }
	    } catch(e) { console.log(e); }
	    j = j + 1;
	}
	return data;
    },
    'Draw': function(qq, divid){
	var q = _.clone(qq);
	var d=[],d1NoPR=[],d1PR=[],d1PRLV=[],d2NoPR=[],d2PR=[];
	try { $('#'+divid).html(""); } catch(e){ console.log(e); }
	try { $('#'+divid+'Title').html(q.gcY+' vs '+q.gcX); } catch(e){ console.log(e); };
	try { 
	    if (q.gcVaryRules){
		// vary rules in q to make multiline graph; use different colors
		q.poHampTier=1;
		q.poDoPR=0;
		q.poDoLenderVariation=0;
		d1NoPR = hampGraph.Calculate(q);
		q.poDoPR=1;
		d1PR = hampGraph.Calculate(q);
		q.poDoLenderVariation=1;
		d1PRLV = hampGraph.Calculate(q);
		q.poHampTier=2;
		q.poDoPR=0;
		q.poDoLenderVariation=0;
		d2NoPR = hampGraph.Calculate(q);
		q.poDoPR=1;
		d2PR = hampGraph.Calculate(q);
		d=[d1NoPR,d1PR,d1PRLV,d2NoPR,d2PR];
	    } else {
		// no variation of rules to make single line graph -- use original rules in q
		d=[hampGraph.Calculate(q)];
	    }
	    $.jqplot(divid, d);
	    return true;
	} catch(e){ console.log(e); }
	return false;	
    },
    'Create': function(){
	var q = readInputs();
	var allGraphs;
	try {
	    $("#Graph1, #GraphAll").hide();
	    if (q.gcY !== "almostEverything"){
		$('#Graph1').show();
		hampGraph.Draw(q,"Graph1");
		return true;
	    }
	    $('#GraphAll').show();
	    allGraphs = ['mlTotalPayments','mlMoPayment1to5','mlPR','mlUnpaid','mlRate1to5','mlMonths','mlBalloon'];
	    _.each(allGraphs, function(yvar, i){
		var ii = i+1;
		q.gcY = yvar;
		hampGraph.Draw(q,'GraphAll'+ii);
	    });
	    return true;
	} catch(e){ console.log(e); }
	return false;
    }
};

