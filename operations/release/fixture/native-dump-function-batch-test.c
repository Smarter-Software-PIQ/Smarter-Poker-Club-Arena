/* Credential-free compiled result/ordinal/cache contract. Not database proof. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdarg.h>
#include <unistd.h>
#define lengthof(x) (sizeof(x)/sizeof((x)[0]))
typedef unsigned int Oid;
typedef struct { Oid oid; } CatalogId;
typedef struct { int objType, dump, components; CatalogId catId; } DumpableObject;
typedef struct { DumpableObject dobj; char relkind; bool dummy_view; int nargs; Oid *argtypes; } FuncInfo;
typedef struct { char *ftypname; } TypeInfo;
static TypeInfo *test_types;
static int test_type_count;
static TypeInfo *findTypeByOid(Oid oid){return oid>0 && oid<=(Oid)test_type_count?&test_types[oid-1]:NULL;}
static char *pg_strdup(const char *value){size_t n=strlen(value)+1;char *copy=malloc(n);if(!copy)exit(113);memcpy(copy,value,n);return copy;}
#define pg_free free
typedef FuncInfo TableInfo;
typedef struct { int remoteVersion; } Archive;
typedef struct { int status, rows, fields, cleared, type_name; Oid type_oid; } PGresult;
typedef struct { char data[65536]; } Buffer;
typedef Buffer *PQExpBuffer;
#define DO_FUNC 1
#define DO_TABLE 2
#define DO_TYPE 3
#define DO_AGG 4
#define DUMP_COMPONENT_DEFINITION 1
#define RELKIND_SEQUENCE 'S'
#define RELKIND_VIEW 'v'
#define RELKIND_MATVIEW 'm'
#define DO_RULE 5
#define PGRES_TUPLES_OK 2
#define fmtQualifiedDumpable(t) "synthetic_sequence"
static const char *mode, *fault;
static int sent, delivered, cleared, created, requests, query_open, fields;
static PGresult results[20000];
static const char *names[] = {"proretset","prosrc","probin","provolatile","proisstrict","prosecdef","lanname","proconfig","procost","prorows","funcargs","funciargs","funcresult","proleakproof","protrftypes","proparallel","prokind","prosupport","prosqlbody"};
static Oid sent_type_oids[128];
static bool sending_type_names;
static const char *type_names[] = {"format_type"};
static const char *view_names[] = {"viewdef"};
static const char *sequence_names[] = {"format_type","seqstart","seqincrement","seqmax","seqmin","seqcache","seqcycle"};
static void check_cleanup(void);
static void pg_fatal(const char *message) { (void)message; exit(23); }
static PQExpBuffer createPQExpBuffer(void) { return calloc(1,sizeof(Buffer)); }
static void destroyPQExpBuffer(PQExpBuffer b) { free(b); }
static void appendPQExpBuffer(PQExpBuffer b,const char *format,...) {
    va_list args;size_t used=strlen(b->data);int count;
    va_start(args,format);count=vsnprintf(b->data+used,sizeof(b->data)-used,format,args);va_end(args);
    if(count<0 || (size_t)count>=sizeof(b->data)-used)exit(102);
}
static void *GetConnection(Archive *a) { return a; }
static void ca_diag_query_begin(void) { if(query_open)exit(90); query_open=1; }
static void ca_diag_query_begin_subtype(int subtype){if(subtype!=1 && subtype!=4 && subtype!=7 && subtype!=10)exit(106);ca_diag_query_begin();}
static void ca_diag_query_end(void) { if(!query_open)exit(91); query_open=0; }
static int PQsendQuery(void *connection,const char *sql) {
    const char *at=sql;(void)connection;
    if(!strcmp(fault,"send"))return 0;
    sending_type_names=strstr(sql,"SELECT pg_catalog.format_type(")!=NULL;
    fields=sending_type_names?1:strstr(sql,"pg_get_viewdef")?1:strstr(sql,"pg_catalog.pg_sequence")?7:19;
    sent=delivered=0;requests++;
    for(;*at;at++) {
        if(!strncmp(at,"SELECT pg_catalog.format_type('",31)){unsigned oid;if(sscanf(at,"SELECT pg_catalog.format_type('%u'",&oid)!=1||sent>=128)exit(114);sent_type_oids[sent]=oid;}
        if(*at==';')sent++;
        if((!strcmp(mode,"mixed") || !strcmp(mode,"partial")) && !strncmp(at,"EXECUTE dumpFunc('",18)) {
            unsigned oid=0;
            if(sscanf(at,"EXECUTE dumpFunc('%u'",&oid)!=1 || oid%4!=1)exit(100);
        }
        if((!strcmp(mode,"seq-mixed") || !strcmp(mode,"seq-filter")) && !strncmp(at,"WHERE seqrelid = '",17)) {
            unsigned oid=0;
            if(sscanf(at,"WHERE seqrelid = '%u'",&oid)!=1 || oid%4!=1)exit(100);
        }
    }
    if(sent==0)sent=1; /* Original stock singleton has no semicolon. */
    if(sent<1||sent>128)exit(92);
    return 1;
}
static PGresult *PQgetResult(void *connection) {
    PGresult *r;(void)connection;
    if(!strcmp(fault,"interrupt") || (!strcmp(fault,"partial-interrupt") && delivered>0)){if(write(STDOUT_FILENO,"WAIT\n",5)!=5)exit(96);sleep(20);}
    if(delivered==sent+(!strcmp(fault,"extra")?1:0)-(!strcmp(fault,"missing")?1:0))return NULL;
    if(created>=20000)exit(103);
    delivered++;r=&results[created++];r->status=PGRES_TUPLES_OK;r->rows=1;r->fields=fields;r->type_name=sending_type_names;r->type_oid=sending_type_names?sent_type_oids[(delivered-1)%128]:0;
    if(!strcmp(fault,"status"))r->status=9;
    if(!strcmp(fault,"rows"))r->rows=0;
    if(!strcmp(fault,"fields"))r->fields=fields-1;
    return r;
}
static int PQresultStatus(PGresult *r){return r->status;}
static int PQntuples(PGresult *r){return r->rows;}
static int PQnfields(PGresult *r){return r->fields;}
static char *PQfname(PGresult *r,int f){return (char *)(!strcmp(fault,"name")?"wrong":r->type_name?type_names[f]:r->fields==1?view_names[f]:r->fields==7?sequence_names[f]:names[f]);}
static char *PQgetvalue(PGresult *r,int row,int field){static char value[80];(void)row;(void)field;snprintf(value,sizeof(value),"synthetic_type_%u",r->type_oid);return value;}
static int PQgetisnull(PGresult *r,int row,int f){(void)r;(void)row;(void)f;return !strcmp(fault,"null");}
static int PQgetlength(PGresult *r,int row,int f){
    (void)row;(void)f;
    if(!strcmp(fault,"empty"))return 0;
    if(!strcmp(mode,"type-shared-bytes"))return r->type_name?2097152:50000;
    if(!strcmp(mode,"view-shared-bytes"))return r->fields==1?1050000:130000;
    if(!strcmp(mode,"shared-bytes"))return r->fields==19?50000:2097152;
    if(!strcmp(mode,"shared-bytes-sequence-first"))return r->fields==7?130000:1000000;
    return !strcmp(fault,"bytes")?128*1024*1024:1;
}
static void PQclear(PGresult *r){if(r->cleared)exit(93);r->cleared=1;cleared++;}
static PGresult *ExecuteSqlQuery(Archive *a,const char *sql,int status){
    PGresult *r,*extra;(void)status;ca_diag_query_begin();
    if(!PQsendQuery(a,sql))pg_fatal("stock send");
    r=PQgetResult(a);extra=PQgetResult(a);ca_diag_query_end();
    if(extra){PQclear(extra);if(r)PQclear(r);pg_fatal("stock extra");}
    if(!r)pg_fatal("stock missing");
    return r;
}
static PGresult *ExecuteSqlQueryForSingleRow(Archive *a,const char *sql){return ExecuteSqlQuery(a,sql,PGRES_TUPLES_OK);}
#include "native-dump-function-batch.c"
#ifdef CA_SEQUENCE_STOCK_COUNTERFACTUAL
#include "native-dump-sequence-stock-reader.c"
#else
#include "native-dump-sequence-batch.c"
#endif
#ifdef CA_VIEW_STOCK_COUNTERFACTUAL
#include "native-dump-view-stock-reader.c"
#else
#include "native-dump-view-batch.c"
#endif
#ifdef CA_TYPE_NAME_STOCK_COUNTERFACTUAL
#include "native-dump-type-name-stock-reader.c"
#else
#include "native-dump-type-name-batch.c"
#endif
static void check_cleanup(void){
    int i;
    if(cleared!=created || ca_metadata_cached_results || ca_metadata_cached_bytes)_Exit(98);
    if(test_types && strncmp(mode,"type-",5)==0 && strcmp(mode,"type-partial")!=0)
        for(i=0;i<test_type_count;i++)if(test_types[i].ftypname)_Exit(118);
}
int main(int argc,char **argv){
    Archive archive={170011};int i,n,selected=0;DumpableObject **objects;FuncInfo *items;
    bool sequence,interleave,view;
    if(argc!=3)return 94;
    mode=argv[1];view=!strncmp(mode,"view-",5);fault=!strncmp(mode,"type-",5)?mode+5:view?mode+5:!strncmp(mode,"seq-",4)?mode+4:mode;n=atoi(argv[2]);
    sequence=!strncmp(mode,"seq-",4);interleave=!strncmp(mode,"interleave-",11)||!strncmp(mode,"shared-bytes",12);
    atexit(check_cleanup);
    objects=calloc(n,sizeof(*objects));items=calloc(n,sizeof(*items));
    for(i=0;i<n;i++){
        items[i].dobj=(DumpableObject){DO_FUNC,1,1,{(Oid)(i+1)}};
        if(i%137==136)items[i].dobj.objType=DO_TABLE;
        if(i%131==130)items[i].dobj.dump=0;
        if(!strcmp(mode,"excluded-boundary") && i%2==1){items[i].dobj.objType=DO_TABLE;items[i].dobj.dump=0;}
        if(!strcmp(mode,"mixed") || !strcmp(mode,"partial")){items[i].dobj.objType=1+i%4;items[i].dobj.dump=1;}
        if(sequence){
            items[i].dobj=(DumpableObject){DO_TABLE,1,1,{(Oid)(i+1)}};items[i].relkind=RELKIND_SEQUENCE;
            if(!strcmp(mode,"seq-mixed"))items[i].dobj.objType= i%4==0?DO_TABLE:i%4==1?DO_TABLE:i%4==2?DO_TYPE:DO_AGG;
            if(!strcmp(mode,"seq-mixed") && i%4==1)items[i].relkind='r';
            if(!strcmp(mode,"seq-filter")){
                if(i%4==1)items[i].dobj.dump=2;
                if(i%4==2)items[i].dobj.components=0;
                if(i%4==3)items[i].relkind='r';
            }
        }
        if(interleave){
            bool seqfirst=strstr(mode,"sequence-first")!=NULL;
            items[i].dobj=(DumpableObject){(i%2==0)==seqfirst?DO_TABLE:DO_FUNC,1,1,{(Oid)(i+1)}};
            items[i].relkind=RELKIND_SEQUENCE;
        }
        if(view){
            items[i].dobj=(DumpableObject){DO_TABLE,1,1,{(Oid)(i+1)}};
            items[i].relkind=i%2?RELKIND_MATVIEW:RELKIND_VIEW;
            if(!strcmp(mode,"view-filter")){
                if(i%4==1)items[i].dobj.dump=2;
                if(i%4==2)items[i].dummy_view=true;
                if(i%4==3)items[i].dobj.components=0;
            }
            if(!strcmp(mode,"view-mixed") || !strcmp(mode,"view-partial")){
                if(i%4==1)items[i].dobj.objType=DO_TYPE;
                if(i%4==2)items[i].dummy_view=true;
                if(i%4==3)items[i].dobj.objType=DO_RULE;
            }
            if(strstr(mode,"cross") || !strcmp(mode,"view-shared-bytes")){
                int which=(i+(!strcmp(mode,"view-cross-function-first")?1:!strcmp(mode,"view-cross-sequence-first")?2:0))%3;
                items[i].dobj.objType=which==1?DO_FUNC:DO_TABLE;
                if(which==2)items[i].relkind=RELKIND_SEQUENCE;
            }
        }
        objects[i]=&items[i].dobj;
    }
    ca_batch_objects=objects;ca_batch_objects_count=n;
    if(!strncmp(mode,"type-",5)){
        Oid *arguments=calloc(n?n:1,sizeof(Oid));test_types=calloc(n?n:1,sizeof(TypeInfo));test_type_count=n;
        for(i=0;i<n;i++){items[i].dobj=(DumpableObject){DO_FUNC,1,1,{(Oid)(i+1)}};arguments[i]=(Oid)(i+1);items[i].nargs=1;items[i].argtypes=&arguments[i];}
        if(!strcmp(mode,"type-cached"))for(i=0;i<n;i++)test_types[i].ftypname=pg_strdup("cached");
        for(i=0;i<n;i++){
            Oid oid=(Oid)(i+1);PGresult *result;char query[160];bool batched;
            ca_batch_position=i;
            if(!strcmp(mode,"type-zero"))continue;
            if(test_types[i].ftypname)continue;
            if(!strcmp(mode,"type-unknown"))oid=(Oid)(n+7);
            if(!strcmp(mode,"type-position"))ca_batch_position=-1;
            if((!strcmp(mode,"type-shared-bytes") || !strcmp(mode,"type-cross-function-cache")) && i==0){
                PGresult *function;snprintf(query,sizeof(query),"EXECUTE dumpFunc('%u')",oid);
                function=ca_function_batch_result(&archive,&items[i],query);PQclear(function);
            }
            batched=ca_type_name_batch_prefetch(&archive,oid);
            if(!strcmp(mode,"type-unknown") || !strcmp(mode,"type-position")){if(batched || requests)return 115;continue;}
            if(!batched){
                snprintf(query,sizeof(query),"SELECT pg_catalog.format_type('%u'::pg_catalog.oid, NULL)",oid);
                result=ExecuteSqlQuery(&archive,query,PGRES_TUPLES_OK);
                test_types[i].ftypname=pg_strdup(PQgetvalue(result,0,0));PQclear(result);
            }
            if(created-cleared!=ca_metadata_cached_results)return 119;
            if(!strcmp(mode,"type-partial"))exit(23);
        }
        if(!strcmp(mode,"type-valid") && requests!=(n+127)/128){
            /* Intentional singleton counterfactual has legitimate native names,
             * not an incomplete batch. Release them before its deliberate RED. */
            for(i=0;i<n;i++){free(test_types[i].ftypname);test_types[i].ftypname=NULL;}
            return 112;
        }
        if((!strcmp(mode,"type-zero") || !strcmp(mode,"type-cached") || !strcmp(mode,"type-unknown") || !strcmp(mode,"type-position")) && requests)return 115;
        for(i=0;i<n;i++){
            char expected[80];snprintf(expected,sizeof(expected),"synthetic_type_%u",i+1);
            if(!strcmp(mode,"type-valid") && (!test_types[i].ftypname || strcmp(test_types[i].ftypname,expected)))return 116;
            free(test_types[i].ftypname);
        }
        if(!strcmp(mode,"type-cross-function-cache"))ca_function_batch_clear();
        if(query_open || ca_metadata_cached_results || ca_metadata_cached_bytes)return 117;
        free(test_types);test_types=NULL;test_type_count=0;free(arguments);free(objects);free(items);return 0;
    }
    for(i=0;i<n;i++){
        PGresult *r;char query[256];ca_batch_position=i;
        if(objects[i]->objType==DO_FUNC && objects[i]->dump){
            if(!strcmp(mode,"order") && i==1)ca_batch_oids[ca_batch_next]=99999;
            snprintf(query,sizeof(query),"EXECUTE dumpFunc('%u')",objects[i]->catId.oid);
            r=ca_function_batch_result(&archive,&items[i],query);selected++;PQclear(r);
        }else if(objects[i]->objType==DO_TABLE && items[i].relkind==RELKIND_SEQUENCE &&
                 (objects[i]->dump & objects[i]->components & DUMP_COMPONENT_DEFINITION)){
#ifndef CA_SEQUENCE_STOCK_COUNTERFACTUAL
            if(!strcmp(mode,"seq-order") && i==1)ca_sequence_oids[ca_sequence_next]=99999;
#endif
            snprintf(query,sizeof(query),"SELECT format_type(seqtypid, NULL), seqstart, seqincrement, seqmax, seqmin, seqcache, seqcycle FROM pg_catalog.pg_sequence WHERE seqrelid = '%u'::oid",objects[i]->catId.oid);
            r=ca_sequence_batch_result(&archive,&items[i],query);selected++;PQclear(r);
            if(!strcmp(mode,"seq-partial"))exit(23);
        }else if(view && ca_view_eligible(objects[i])){
#ifndef CA_VIEW_STOCK_COUNTERFACTUAL
            if(!strcmp(mode,"view-order") && i==1)ca_view_oids[ca_view_next]=99999;
#endif
            if(!strcmp(mode,"view-unknown"))ca_batch_position=-1;
            if(!strcmp(mode,"view-surplus"))ca_batch_position=ca_batch_objects_count;
            snprintf(query,sizeof(query),"SELECT pg_catalog.pg_get_viewdef('%u'::pg_catalog.oid) AS viewdef",objects[i]->catId.oid);
            r=ca_view_batch_result(&archive,&items[i],query);selected++;PQclear(r);
            if(!strcmp(mode,"view-partial"))exit(23);
        }else if(view && objects[i]->objType==DO_RULE){
            int cached=ca_metadata_cached_results;
            snprintf(query,sizeof(query),"SELECT pg_catalog.pg_get_viewdef('%u'::pg_catalog.oid) AS viewdef",objects[i]->catId.oid);
            r=ca_view_batch_result(&archive,&items[i],query);PQclear(r);
            if(cached!=ca_metadata_cached_results)return 107;
        }else{
            if(query_open || delivered!=sent)return 99;
            if(!strcmp(mode,"partial"))exit(23);
        }
        if(ca_metadata_cached_results>128 || ca_metadata_cached_bytes>128*1024*1024)return 104;
    }
    if(ca_batch_count!=ca_batch_next || query_open || ca_metadata_cached_results || ca_metadata_cached_bytes)return 95;
    if(view){
        if(!strcmp(mode,"view-valid") && requests!=(n+127)/128)return 108;
        if((!strcmp(mode,"view-unknown") || !strcmp(mode,"view-surplus")) && requests!=n)return 111;
        if(!strcmp(mode,"view-filter") && requests!=(selected+127)/128)return 109;
        if(!strcmp(mode,"view-mixed") && requests!=(selected+127)/128+n/4)return 110;
    }else if(!strcmp(mode,"mixed") || !strcmp(mode,"seq-mixed") || !strcmp(mode,"seq-filter")){
        if(requests!=(selected+127)/128 || cleared!=selected)return 97;
    }else if(sequence){if(requests!=(n+127)/128)return 97;}
    else if(interleave){if(n==257 && requests!=130)return 105;}
    else if(!strcmp(mode,"excluded-boundary")){if(requests!=1)return 97;}
    else if(n>128 && requests<2)return 95;
    free(objects);free(items);return 0;
}
